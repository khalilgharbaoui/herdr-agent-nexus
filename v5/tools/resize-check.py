#!/usr/bin/env python3
"""What a resize costs in memory, measured on a second copy of v5 that draws on a stand-in
terminal (a pty this script answers for), so the pane the operator looks at is never resized.

  python3 v5/tools/resize-check.py [--from 91] [--to 139] [--rows 82] [--settle 150]
                                   [--after 300] [--every 30] [--steps 48] [--fresh] [--demo]

It starts v5 at --from columns, lets it settle, samples its physical footprint (`footprint`),
then drags the width to --to one column at a time as a hand on a split does, and samples again
for --after seconds. --fresh starts at --to and never resizes: the level a resize should come
back to. The stand-in answers the size and mouse queries, says OK to every sprite page and
heartbeat, and throws the pictures away. It reads the same data as the live copy and writes
its own files to a temporary folder (NEXUS_RUN).
"""
import argparse, fcntl, json, os, pty, re, select, signal, struct, subprocess, sys, tempfile, termios, time

parser = argparse.ArgumentParser()
parser.add_argument("--from", dest="start", type=int, default=91)
parser.add_argument("--to", type=int, default=139)
parser.add_argument("--rows", type=int, default=82)
parser.add_argument("--settle", type=float, default=150)
parser.add_argument("--after", type=float, default=300)
parser.add_argument("--every", type=float, default=30)
parser.add_argument("--steps", type=int, default=0, help="resize events of the drag (default: one per column)")
parser.add_argument("--fresh", action="store_true")
parser.add_argument("--demo", action="store_true")
parser.add_argument("--label", default="")
args = parser.parse_args()

CELL_W, CELL_H = 15, 30
HERE = os.path.dirname(os.path.abspath(__file__))
run = tempfile.mkdtemp(prefix="nexus-resize-")
cols = args.to if args.fresh else args.start


def set_size(fd, columns):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, columns, columns * CELL_W, args.rows * CELL_H))


pid, fd = pty.fork()
if pid == 0:
    os.environ["NEXUS_RUN"] = run
    os.environ["COLUMNS"] = str(cols)
    os.environ["LINES"] = str(args.rows)
    command = ["node", "--no-warnings", os.path.join(HERE, "..", "nexus.mjs")] + (["--demo"] if args.demo else [])
    os.execvp(command[0], command)
set_size(fd, cols)

SEQ = re.compile(rb"\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\|\x1b\[([?0-9;$]*)([a-zA-Z])")
pending = b""
upload = None  # id of a page upload whose chunks are still coming
bytes_in = 0


def answer(data):
    global pending, upload, bytes_in
    bytes_in += len(data)
    data = pending + data
    out = []
    end = 0
    for match in SEQ.finditer(data):
        end = match.end()
        if match.group(1) is not None:
            keys = match.group(1).decode("latin1")
            fields = dict(part.split("=", 1) for part in keys.split(",") if "=" in part)
            if "a" in fields or "i" in fields:
                quiet = "q" in fields
                if fields.get("a") == "q":
                    out.append(b"\x1b_Gi=%s;OK\x1b\\" % fields.get("i", "0").encode())
                elif fields.get("a") == "t" and not quiet:
                    if fields.get("m") == "1":
                        upload = fields.get("i")
                    else:
                        out.append(b"\x1b_Gi=%s;OK\x1b\\" % fields.get("i", "0").encode())
                elif fields.get("a") == "p" and not quiet:
                    out.append(b"\x1b_Gi=%s,p=%s;OK\x1b\\" % (fields.get("i", "0").encode(), fields.get("p", "0").encode()))
                elif fields.get("m") == "1" and "a" not in fields:
                    pass
            elif fields.get("m") == "0" and upload is not None:
                out.append(b"\x1b_Gi=%s;OK\x1b\\" % upload.encode())
                upload = None
        else:
            params, final = match.group(3), match.group(4)
            if final == b"c" and not params.startswith(b"?"):
                out.append(b"\x1b[?62;4c")
            elif final == b"t" and params == b"16":
                out.append(b"\x1b[6;%d;%dt" % (CELL_H, CELL_W))
            elif final == b"t" and params == b"14":
                out.append(b"\x1b[4;%d;%dt" % (args.rows * CELL_H, cols * CELL_W))
            elif final == b"p" and params.endswith(b"$"):
                mode = params[1:-1]
                out.append(b"\x1b[?%s;%d$y" % (mode, 1 if mode in (b"1003", b"1006", b"1016") else 2))
    rest = data[end:]
    cut = rest.rfind(b"\x1b")
    pending = rest[cut:] if cut >= 0 and len(rest) - cut < 8192 else b""
    if out:
        os.write(fd, b"".join(out))


def pump(seconds):
    until = time.time() + seconds
    while True:
        left = until - time.time()
        if left <= 0:
            return
        ready, _, _ = select.select([fd], [], [], min(left, 0.25))
        if ready:
            try:
                answer(os.read(fd, 1 << 16))
            except OSError:
                sys.exit("v5 ended")


def megabytes(text):
    match = re.match(r"([\d.]+) (B|KB|MB|GB)", text.strip())
    return float(match.group(1)) * {"B": 1 / 1048576, "KB": 1 / 1024, "MB": 1, "GB": 1024}[match.group(2)] if match else 0


def footprint():
    out = subprocess.run(["footprint", str(pid)], capture_output=True, text=True).stdout
    def row(name):
        match = re.search(r"^\s*([\d.]+ (?:B|KB|MB|GB))\s+.*\s" + name + r"\s*$", out, re.M)
        return megabytes(match.group(1)) if match else 0
    total = re.search(r"phys_footprint: ([\d.]+ (?:B|KB|MB|GB))", out)
    peak = re.search(r"phys_footprint_peak: ([\d.]+ (?:B|KB|MB|GB))", out)
    return megabytes(total.group(1)) if total else 0, row("Malloc Large"), row("Malloc Small"), row("App-Specific Tag 16"), megabytes(peak.group(1)) if peak else 0


started = time.time()
last_bytes = 0
last_at = started


def sample(note):
    global last_bytes, last_at
    total, large, small, v8, peak = footprint()
    now = time.time()
    rate = (bytes_in - last_bytes) / 1024 / max(0.001, now - last_at)
    last_bytes, last_at = bytes_in, now
    try:
        with open(os.path.join(run, "stats.json")) as handle:
            stats = json.load(handle)
    except (OSError, ValueError):
        stats = {}
    said = "cpu %4s%%  reads %4s/s %4s MB/s  %s/%s working  sprites %s" % (stats.get("cpuPercent", "?"), stats.get("readbacksPerSecond", "?"), stats.get("readbackMbPerSecond", "?"), stats.get("working", "?"), stats.get("threads", "?"), (stats.get("graphics") or {}).get("verdict", "?"))
    print("%s %5.0fs  %3d cols  footprint %4.0f MB  large %4.0f  small %4.0f  v8 %4.0f  peak %4.0f  %5.0f kB/s  %s  %s" % (args.label, now - started, cols, total, large, small, v8, peak, rate, said, note), flush=True)


def watch(seconds, note):
    until = time.time() + seconds
    while time.time() < until:
        pump(min(args.every, max(0.1, until - time.time())))
        sample(note)


try:
    watch(args.settle, "fresh at %d" % cols)
    if not args.fresh:
        steps = args.steps or abs(args.to - args.start)
        for step in range(1, steps + 1):
            cols = round(args.start + (args.to - args.start) * step / steps)
            set_size(fd, cols)
            pump(0.04)
        sample("right after the drag")
        watch(args.after, "after the drag from %d" % args.start)
finally:
    try:
        os.write(fd, b"q")
        pump(1.0)
    except (OSError, SystemExit):
        pass
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
