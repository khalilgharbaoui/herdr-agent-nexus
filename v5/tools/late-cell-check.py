#!/usr/bin/env python3
"""A pane that is up before its terminal has pixels, on a stand-in terminal (a pty this script
answers for).

herdr answers neither size query (CSI 14 t, CSI 16 t) for a pane while no client is attached to
its server: it has no pixel geometry to give. That is where a pane stands that the plugin's
startup entry opens right after a server restart. This script is such a terminal for --silent
seconds: it answers the Kitty graphics query and the device attributes, and stays silent on the
size queries. Then it answers them with a cell that is not the one v5 assumes, and sends no
resize, as a first client does when it brings pixels and changes no column and no row.

  python3 v5/tools/late-cell-check.py [--cols 91] [--rows 40] [--silent 4] [--cell 12x24]

Passes when v5 runs at its assumed cell while the terminal is silent and at the terminal's
cell within two seconds of the first answer, and counts that as one resize.
"""
import argparse, fcntl, json, os, pty, re, select, signal, struct, sys, tempfile, termios, time

parser = argparse.ArgumentParser()
parser.add_argument("--cols", type=int, default=91)
parser.add_argument("--rows", type=int, default=40)
parser.add_argument("--silent", type=float, default=4)
parser.add_argument("--cell", default="12x24")
args = parser.parse_args()

CELL_W, CELL_H = (int(part) for part in args.cell.split("x"))
HERE = os.path.dirname(os.path.abspath(__file__))
run = tempfile.mkdtemp(prefix="nexus-late-cell-")

pid, fd = pty.fork()
if pid == 0:
    os.environ["NEXUS_RUN"] = run
    os.environ.pop("HERDR_ENV", None)
    os.execvp("node", ["node", "--no-warnings", os.path.join(HERE, "..", "nexus.mjs"), "--demo"])
# columns and rows from the start, and no pixels in the window size either
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))

SEQ = re.compile(rb"\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\|\x1b\[([?0-9;$]*)([a-zA-Z])")
pending = b""
upload = None
has_pixels = False
asked = {"silent": 0, "answered": 0}


def answer(data):
    global pending, upload
    data = pending + data
    out = []
    end = 0
    for match in SEQ.finditer(data):
        end = match.end()
        if match.group(1) is not None:
            fields = dict(part.split("=", 1) for part in match.group(1).decode("latin1").split(",") if "=" in part)
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
            elif fields.get("m") == "0" and upload is not None:
                out.append(b"\x1b_Gi=%s;OK\x1b\\" % upload.encode())
                upload = None
        else:
            params, final = match.group(3), match.group(4)
            if final == b"c" and not params.startswith(b"?"):
                out.append(b"\x1b[?62;4c")
            elif final == b"t" and params in (b"16", b"14"):
                asked["answered" if has_pixels else "silent"] += 1
                if has_pixels and params == b"16":
                    out.append(b"\x1b[6;%d;%dt" % (CELL_H, CELL_W))
                elif has_pixels:
                    out.append(b"\x1b[4;%d;%dt" % (args.rows * CELL_H, args.cols * CELL_W))
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


def stats():
    try:
        with open(os.path.join(run, "stats.json")) as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


failed = []
try:
    pump(args.silent)
    before = stats()
    print("silent for %.0f s: v5 runs at %s px in %sx%s cells, cell %s, %s resizes, asked %d times in vain" % (args.silent, before.get("size"), before.get("cols"), before.get("rows"), before.get("cell"), before.get("resizes"), asked["silent"]))
    if before.get("size") != "%dx%d" % (args.cols * 15, args.rows * 30):
        failed.append("while the terminal is silent v5 should run at its assumed cell of 15x30")
    if asked["silent"] < 3:
        failed.append("v5 should have asked again while the terminal was silent")
    has_pixels = True
    answered_at = time.time()
    after = {}
    while time.time() - answered_at < 6:
        pump(0.5)
        after = stats()
        if after.get("size") == "%dx%d" % (args.cols * CELL_W, args.rows * CELL_H):
            break
    took = time.time() - answered_at
    print("pixels arrive, no resize sent: v5 runs at %s px, cell %s, %s resizes, %.1f s after the first answer (stats.json is written every 2 s)" % (after.get("size"), after.get("cell"), after.get("resizes"), took))
    if after.get("size") != "%dx%d" % (args.cols * CELL_W, args.rows * CELL_H):
        failed.append("v5 did not take the terminal's cell")
    if after.get("resizes") != (before.get("resizes") or 0) + 1:
        failed.append("the new cell should count as one resize")
    quiet = asked["answered"]
    pump(3)
    print("asked %d more times in the three seconds after it knew" % (asked["answered"] - quiet))
    if asked["answered"] - quiet > 0:
        failed.append("v5 should stop asking once the terminal has said")
    if after.get("error"):
        failed.append("v5 reports an error: %s" % after.get("error"))
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

for line in failed:
    print("FAILED: %s" % line)
print("late-cell-check: %s" % ("failed" if failed else "passed"))
sys.exit(1 if failed else 0)
