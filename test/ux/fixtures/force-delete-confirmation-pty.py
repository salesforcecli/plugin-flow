"""Exercise the real Node input prompt on an actual PTY, leaving its master open."""

import errno
import os
import pty
import select
import sys
import time

node, child_file, mode = sys.argv[1:]
pid, master = pty.fork()
if pid == 0:
    os.execv(node, [node, child_file, "250" if mode.startswith("timeout") else "2000", "stderr" if mode == "stderr-match" else "stdout"])

seen = bytearray()
flow_answered = False
version_answered = False
started = time.monotonic()
while True:
    if time.monotonic() - started > 5:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
        raise RuntimeError("The real confirmation prompt did not exit naturally")
    readable, _, _ = select.select([master], [], [], 0.05)
    if not readable:
        continue
    try:
        chunk = os.read(master, 65536)
    except OSError as error:
        if error.errno != errno.EIO:
            raise
        break
    if not chunk:
        break
    seen.extend(chunk)
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()
    if not flow_answered and b"TYPE_FLOW_API_NAME:" in seen:
        flow_answered = True
        answer = {
            "match": b"Fixture_Flow\n",
            "stderr-match": b"Fixture_Flow\n",
            "mismatch": b"Other_Flow\n",
            "version-mismatch": b"Fixture_Flow\n",
            "timeout-version": b"Fixture_Flow\n",
            "cancel": b"\x03",
        }.get(mode)
        if answer is not None:
            os.write(master, answer)
    if not version_answered and b"TYPE_VERSION_NUMBER:" in seen:
        version_answered = True
        if mode in ("match", "stderr-match", "version-mismatch"):
            os.write(master, b"012\n" if mode == "version-mismatch" else b"12\n")

_, status = os.waitpid(pid, 0)
os.close(master)
sys.exit(os.waitstatus_to_exitcode(status))
