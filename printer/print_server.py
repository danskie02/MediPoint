
#!/usr/bin/env python3

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

# ==========================================
# PRINTER CONFIGURATION
# ==========================================

PRINTER = os.environ.get(
    "MEDIPOINT_PRINTER_DEVICE",
    "/dev/usb/lp0"
)

HOST = "127.0.0.1"
PORT = 8765

# Allow CareMate frontend
ALLOWED_ORIGINS = {
    "null",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
}


# ==========================================
# ESC/POS TEXT CONVERSION
# ==========================================

def escpos_text(text):
    return str(text).encode("ascii", errors="replace")


# ==========================================
# RECEIPT GENERATOR
# ==========================================

def make_receipt(data):

    def compact_label(title):
        title_text = str(title or "Measurement").lower()

        if "blood pressure" in title_text:
            return "BP"
        if "heart rate" in title_text or "pulse" in title_text:
            return "HR"
        if "respiratory" in title_text:
            return "RR"
        if "oxygen" in title_text or "spo2" in title_text:
            return "SpO2"
        if "temperature" in title_text:
            return "Temp"
        if "height" in title_text:
            return "Height"
        if "weight" in title_text:
            return "Weight"
        if "bmi" in title_text:
            return "BMI"
        return (title or "Vitals")[:6].strip() or "Vitals"

    def normalize_unit(unit):
        unit_text = str(unit or "").strip()
        lowered = unit_text.lower().replace("°", "")
        if lowered in {"c", "deg c", "degc", "celsius"}:
            return "deg C"
        if lowered in {"f", "deg f", "degf", "fahrenheit"}:
            return "deg F"
        return unit_text.replace("°", "deg ")

    def parse_number(value):
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return float(text.replace(",", ""))
        except ValueError:
            digits = "".join(
                ch if ch.isdigit() or ch in ".-" else " "
                for ch in text
            ).split()
            if not digits:
                return None
            try:
                return float(digits[0])
            except ValueError:
                return None

    def parse_blood_pressure(value):
        text = str(value or "")
        parts = [part for part in text.replace(" ", "").split("/") if part]
        if len(parts) < 2:
            return None, None
        return parse_number(parts[0]), parse_number(parts[1])

    def derive_indication(title, value, status):
        title_text = str(title or "").lower()
        status_text = str(status or "").strip() or "Recorded"

        if "blood pressure" in title_text:
            systolic, diastolic = parse_blood_pressure(value)
            if systolic is None or diastolic is None:
                return status_text if status_text == "Normal" else "Check BP"
            if systolic > 180 or diastolic > 120:
                return "Hypertensive Crisis"
            if systolic >= 140 or diastolic >= 90:
                return "Hypertension Stage 2"
            if systolic >= 130 or diastolic >= 80:
                return "Hypertension Stage 1"
            if systolic < 90 or diastolic < 60:
                return "Low Blood Pressure"
            return "Normal"

        number = parse_number(value)
        if number is None:
            if "height" in title_text or "weight" in title_text:
                return "Recorded"
            return status_text if status_text == "Normal" else "Review"

        if "temperature" in title_text:
            if number < 35:
                return "Hypothermia"
            if number < 37.5:
                return "Normal"
            if number <= 38.0:
                return "Low-Grade Fever"
            if number <= 39.0:
                return "Fever"
            return "High Fever"

        if "heart rate" in title_text or "pulse" in title_text:
            if number < 60:
                return "Bradycardia"
            if number > 100:
                return "Tachycardia"
            return "Normal"

        if "oxygen" in title_text or "spo2" in title_text:
            if number < 90:
                return "Severe Hypoxemia"
            if number < 95:
                return "Hypoxemia"
            return "Normal"

        if "respiratory" in title_text or "respiration" in title_text:
            if number < 12:
                return "Bradypnea"
            if number > 20:
                return "Tachypnea"
            return "Normal"

        if title_text.strip() == "bmi" or "bmi" in title_text:
            if number < 18.5:
                return "Underweight"
            if number <= 24.9:
                return "Normal Weight"
            if number <= 29.9:
                return "Overweight"
            return "Obese"

        if "height" in title_text or "weight" in title_text:
            return "Recorded"

        return status_text if status_text == "Normal" else "Review"

    out = bytearray()

    out += b"\x1b\x40"       # Initialize printer
    out += b"\x1b\x61\x01"   # Center alignment
    out += b"\x1b\x45\x01"   # Bold on

    out += b"MEDIPOINT\n"
    out += b"HEALTH ASSESSMENT\n"

    out += b"\x1b\x45\x00"   # Bold off
    out += b"--------------------------------\n"
    out += b"\x1b\x61\x00"   # Left alignment

    name = data.get("name") or ""
    program = data.get("program") or ""
    measured_at = data.get("measuredAt") or ""

    if name:
        out += escpos_text(f"Name: {name}\n")
    if program:
        out += escpos_text(f"Dept: {program}\n")
    if measured_at:
        out += escpos_text(f"Date: {measured_at}\n")

    out += b"--------------------------------\n"
    out += b"VITALS\n"
    out += b"--------------------------------\n"

    for item in data.get("results", []):
        title = str(item.get("title", "Measurement")).strip() or "Measurement"
        value = str(item.get("value", "")).strip()
        unit = normalize_unit(item.get("unit", ""))
        status = str(item.get("status", "Recorded")).strip() or "Recorded"
        indication = str(item.get("indication", "")).strip()

        reading = value
        if unit:
            reading = f"{reading} {unit}" if reading else unit
        if not reading:
            reading = "Recorded"

        if not indication:
            indication = derive_indication(title, value, status)

        label = compact_label(title)
        # Row 1: vital label + reading
        # Row 2: status + clinical indication
        out += escpos_text(f"{label:<8}{reading}\n")
        out += escpos_text(f"{status}   {indication}\n")
        out += b"\n"

    out += b"--------------------------------\n"
    out += escpos_text(
        f"Overall: {data.get('overallStatus', 'Normal')}\n"
    )
    out += escpos_text(
        f"Recommend: {data.get('recommendation', 'Maintain Healthy Lifestyle')}\n\n"
    )

    out += b"This assessment is for wellness\n"
    out += b"screening only and is not a\n"
    out += b"diagnosis. Please consult clinic\n"
    out += b"staff for guidance.\n"
    out += b"\n\n\n"

    out += b"\x1d\x56\x00"   # Full cut, if supported

    return bytes(out)


# ==========================================
# HTTP SERVER HANDLER
# ==========================================

class Handler(BaseHTTPRequestHandler):

    # --------------------------------------
    # CORS CONFIGURATION
    # --------------------------------------

    def end_headers(self):

        origin = self.headers.get("Origin")

        if origin and origin.rstrip("/") in ALLOWED_ORIGINS:

            self.send_header(
                "Access-Control-Allow-Origin",
                origin
            )

            self.send_header(
                "Vary",
                "Origin"
            )

            self.send_header(
                "Access-Control-Allow-Methods",
                "GET, POST, OPTIONS"
            )

            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type"
            )

            # Browser Private Network Access
            if self.headers.get(
                "Access-Control-Request-Private-Network"
            ) == "true":

                self.send_header(
                    "Access-Control-Allow-Private-Network",
                    "true"
                )

        super().end_headers()


    # --------------------------------------
    # GET REQUEST
    # --------------------------------------

    def do_GET(self):

        if self.path == "/health":

            self.send_response(200)

            self.send_header(
                "Content-Type",
                "text/plain; charset=utf-8"
            )

            self.end_headers()

            self.wfile.write(
                b"MediPoint printer service is running"
            )

        else:

            self.send_error(404, "Endpoint not found")


    # --------------------------------------
    # POST REQUEST - PRINT RECEIPT
    # --------------------------------------

    def do_POST(self):

        if self.path != "/print":

            self.send_error(404, "Endpoint not found")
            return

        try:

            length = int(
                self.headers.get("Content-Length", "0")
            )

            if length <= 0 or length > 20000:

                self.send_error(
                    400,
                    "Invalid request size"
                )

                return

            raw_data = self.rfile.read(length)

            data = json.loads(
                raw_data.decode("utf-8")
            )

            if not isinstance(data, dict):

                self.send_error(
                    400,
                    "Expected a JSON object"
                )

                return

            # Generate receipt
            receipt = make_receipt(data)

            # Send receipt to USB thermal printer
            with open(PRINTER, "wb") as printer:

                printer.write(receipt)
                printer.flush()

            # Successful response
            self.send_response(200)

            self.send_header(
                "Content-Type",
                "application/json"
            )

            self.end_headers()

            self.wfile.write(
                json.dumps({
                    "ok": True,
                    "message": "Receipt sent"
                }).encode("utf-8")
            )

            print(
                "Receipt successfully sent to printer.",
                flush=True
            )

        except FileNotFoundError:

            self.send_error(
                503,
                "USB printer device not found"
            )

        except (ValueError, json.JSONDecodeError):

            self.send_error(
                400,
                "Invalid JSON"
            )

        except Exception as exc:

            print(
                "Printer error:",
                repr(exc),
                flush=True
            )

            self.send_error(
                500,
                "Printing failed"
            )


    # --------------------------------------
    # OPTIONS REQUEST - CORS PREFLIGHT
    # --------------------------------------

    def do_OPTIONS(self):

        origin = self.headers.get("Origin")

        if origin not in ALLOWED_ORIGINS:
            self.send_error(403, "Origin not allowed")
            return

        self.send_response(204)
        self.end_headers()


    # --------------------------------------
    # SERVER LOGGING
    # --------------------------------------

    def log_message(self, fmt, *args):

        print(
            fmt % args,
            flush=True
        )


# ==========================================
# START PRINTER SERVER
# ==========================================

if __name__ == "__main__":

    print("=" * 45)
    print("       MEDIPOINT PRINTER SERVICE")
    print("=" * 45)

    print(f"Printer Device : {PRINTER}")
    print(f"Server Address : http://{HOST}:{PORT}")
    print(f"Allowed Origins: {ALLOWED_ORIGINS}")

    print("=" * 45)

    try:

        server = HTTPServer(
            (HOST, PORT),
            Handler
        )

        print(
            "Printer service is running...",
            flush=True
        )

        server.serve_forever()

    except KeyboardInterrupt:

        print(
            "\nPrinter service stopped."
        )

    except OSError as exc:

        print(
            "Server startup error:",
            repr(exc),
            flush=True
        )
