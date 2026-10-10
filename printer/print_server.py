
#!/usr/bin/env python3
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

PRINTER = os.environ.get("MEDIPOINT_PRINTER_DEVICE", "/dev/usb/lp0")
HOST = "127.0.0.1"
PORT = 8765


def escpos_text(text):
    # The printer may not support all Unicode characters.
    return str(text).encode("ascii", errors="replace")


def make_receipt(data):
    out = bytearray()
    out += b"\x1b\x40"       # Initialize printer
    out += b"\x1b\x61\x01"   # Center alignment
    out += b"\x1b\x45\x01"   # Bold on
    out += b"MEDIPOINT\n"
    out += b"HEALTH ASSESSMENT\n"
    out += b"\x1b\x45\x00"   # Bold off
    out += b"--------------------------------\n"
    out += b"\x1b\x61\x00"   # Left alignment

    for label in ("name", "program", "measuredAt"):
        value = data.get(label)
        if value:
            heading = {
                "name": "Name",
                "program": "Program/Department",
                "measuredAt": "Date",
            }[label]
            out += escpos_text(f"{heading}: {value}\n")

    out += b"--------------------------------\n"

    for item in data.get("results", []):
        title = item.get("title", "Measurement")
        value = item.get("value", "")
        unit = item.get("unit", "")
        status = item.get("status", "Recorded")
        note = item.get("note", "")
        out += escpos_text(f"{title}: {value} {unit}\n")
        out += escpos_text(f"Status: {status}\n\n")
        if note:
            out += escpos_text(f"Note: {note}\n\n")

    out += b"--------------------------------\n"
    out += b"Health monitoring only; not a diagnosis.\n"
    out += b"\n\n\n"
    out += b"\x1d\x56\x00"   # Full cut, if supported
    return bytes(out)


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin:
            parsed_origin = urlsplit(origin)
            if (
                parsed_origin.scheme == "http"
                and parsed_origin.hostname in {"127.0.0.1", "localhost", "::1"}
                and parsed_origin.username is None
                and parsed_origin.password is None
            ):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"MediPoint printer service is running")
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/print":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 20000:
                self.send_error(400, "Invalid request size")
                return

            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                self.send_error(400, "Expected a JSON object")
                return

            receipt = make_receipt(data)

            # Open only when printing, so the device is not held open.
            with open(PRINTER, "wb") as printer:
                printer.write(receipt)
                printer.flush()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"message":"Receipt sent"}')

        except FileNotFoundError:
            self.send_error(503, "USB printer device not found")
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
        except Exception as exc:
            print("Printer error:", repr(exc), flush=True)
            self.send_error(500, "Printing failed")

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == "__main__":
    print(f"MediPoint printer service: http://{HOST}:{PORT}", flush=True)
    HTTPServer((HOST, PORT), Handler).serve_forever()
