import asyncio
import datetime
from bleak import BleakScanner, BleakClient

MICROLIFE_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
CHAR_NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
CHAR_WRITE_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"
KNOWN_BP_MONITOR_ADDRESSES = {"d6:de:00:cf:49:c4"}

# Microlife framed commands (last byte = checksum = sum of preceding bytes % 256)
CMD_GET_MEASUREMENTS = bytes([77, 255, 0, 9, 0, 0, 0, 0, 0, 0, 0, 253, 82])
CMD_DISCONNECT = bytes([77, 255, 0, 2, 4, 82])

POLL_INTERVAL_SEC = 3.0
RECONNECT_DELAY_SEC = 2.0
SCAN_TIMEOUT_SEC = 10.0


def build_set_time_cmd():
    dt = datetime.datetime.now()
    cmd = [77, 255, 0, 8, 13, dt.year - 2000, dt.month, dt.day, dt.hour, dt.minute, dt.second]
    cmd.append(sum(cmd) % 256)
    return bytes(cmd)


def parse_measurements(payload: bytes):
    """Parse stored readings from get-measurements payload. Returns newest-first list."""
    readings = []
    for i in range(38, len(payload), 10):
        record = payload[i : i + 8]
        if len(record) < 8:
            break
        sys_bp, dia, pulse, year, month, day, hour, minute = record
        if sys_bp == 0 and dia == 0 and pulse == 0:
            continue
        try:
            measured_at = datetime.datetime(2000 + year, month, day, hour, minute)
        except ValueError:
            continue
        readings.append(
            {
                "timestamp": measured_at,
                "systolic": sys_bp,
                "diastolic": dia,
                "pulse": pulse,
            }
        )
    readings.sort(key=lambda r: r["timestamp"], reverse=True)
    return readings


class MicrolifeSession:
    def __init__(self):
        self.received = bytearray()
        self.assembled_result = bytearray()
        self.result_event = asyncio.Event()
        self.last_emitted_key = None
        self.latest_reading = None
        self.latest_callback = None

    def notification_handler(self, _sender, data: bytearray):
        self.received.extend(data)
        while True:
            marker = self.received.find(b"M:")
            if marker < 0:
                self.received = bytearray(b"M" if self.received.endswith(b"M") else b"")
                return
            if marker:
                del self.received[:marker]
            if len(self.received) < 4:
                return

            expected_length = self.received[2] * 256 + self.received[3] + 4
            if expected_length < 5:
                del self.received[0]
                continue
            if len(self.received) < expected_length:
                return

            frame = self.received[:expected_length]
            checksum = sum(frame[:-1]) % 256
            if checksum != frame[-1]:
                print(
                    f"[-] Checksum mismatch: expected {checksum}, got {frame[-1]} "
                    f"(frame length {expected_length})"
                )
                del self.received[0]
                continue

            del self.received[:expected_length]
            self.assembled_result = frame[4:-1]
            self.result_event.set()

    async def send_command(self, client, cmd, wait_for_response=True, timeout=30.0):
        self.received = bytearray()
        self.assembled_result = bytearray()
        self.result_event.clear()

        offset = 0
        while offset < len(cmd):
            chunk = cmd[offset : offset + 20]
            await client.write_gatt_char(CHAR_WRITE_UUID, chunk)
            offset += 20

        if not wait_for_response:
            return None

        try:
            await asyncio.wait_for(self.result_event.wait(), timeout)
        except asyncio.TimeoutError:
            return None
        return self.assembled_result

    def emit_latest_if_new(self, readings):
        if not readings:
            return None

        latest = readings[0]
        key = (
            latest["timestamp"].isoformat(timespec="minutes"),
            latest["systolic"],
            latest["diastolic"],
            latest["pulse"],
        )
        if key == self.last_emitted_key:
            return self.latest_reading

        self.last_emitted_key = key
        self.latest_reading = {
            "timestamp": latest["timestamp"].isoformat(timespec="minutes"),
            "systolic": latest["systolic"],
            "diastolic": latest["diastolic"],
            "pulse": latest["pulse"],
        }
        if self.latest_callback:
            self.latest_callback(self.latest_reading)
        received_at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        measured_at = latest["timestamp"].isoformat(timespec="minutes")
        print(
            f"[NEW] measured_at={measured_at}  "
            f"sys={latest['systolic']}  dia={latest['diastolic']}  "
            f"pulse={latest['pulse']}  received_at={received_at}"
        )
        return self.latest_reading

    async def find_device(self):
        discovered = await BleakScanner.discover(timeout=SCAN_TIMEOUT_SEC)
        for device in discovered:
            if (device.address or "").lower() in KNOWN_BP_MONITOR_ADDRESSES:
                return device

        return await BleakScanner.find_device_by_filter(
            lambda d, adv: (
                (d.address or "").lower() in KNOWN_BP_MONITOR_ADDRESSES
                or MICROLIFE_SERVICE_UUID in (adv.service_uuids or [])
                or (d.name and "BP" in d.name)
            ),
            timeout=SCAN_TIMEOUT_SEC,
        )

    async def run_connected_session(self, device):
        print(f"[+] Connecting to {device.address}...")
        async with BleakClient(device, timeout=20.0) as client:
            if not client.is_connected:
                print("[-] Connection dropped immediately.")
                return

            print("[SUCCESS] Connected. Listening for new readings (Ctrl+C to stop)...")
            await client.start_notify(CHAR_NOTIFY_UUID, self.notification_handler)

            # Keep device clock aligned so measurement timestamps are meaningful
            await self.send_command(client, build_set_time_cmd(), timeout=15.0)

            while client.is_connected:
                payload = await self.send_command(
                    client, CMD_GET_MEASUREMENTS, timeout=20.0
                )
                if payload is not None:
                    readings = parse_measurements(payload)
                    self.emit_latest_if_new(readings)
                else:
                    # No response usually means the cuff session interrupted BLE
                    if not client.is_connected:
                        break

                await asyncio.sleep(POLL_INTERVAL_SEC)

            try:
                await client.stop_notify(CHAR_NOTIFY_UUID)
            except Exception:
                pass

        print("[*] Disconnected from monitor.")


class BloodPressureMonitorService:
    def __init__(self):
        self.latest = None
        self.revision = 0
        self._latest_key = None
        self._task = None

    def record_latest_result(self, reading):
        if not reading:
            return None
        next_result = {
            "systolic": reading.get("systolic"),
            "diastolic": reading.get("diastolic"),
            "pulse": reading.get("pulse"),
        }
        if reading.get("timestamp") is not None:
            next_result["timestamp"] = reading.get("timestamp")
        next_result = {key: value for key, value in next_result.items() if value is not None}
        reading_key = tuple(sorted(next_result.items()))
        if reading_key != self._latest_key:
            self.latest = next_result
            self._latest_key = reading_key
            self.revision += 1
        return self.latest

    def get_latest_result(self):
        if self.latest is None:
            return None
        return dict(self.latest)

    async def start(self):
        if self._task is not None and not self._task.done():
            return self.latest

        self._task = asyncio.create_task(self._run())
        return self.latest

    async def stop(self):
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        return self.latest

    async def wait_for_result(self, after_revision=0, timeout_seconds=120.0):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_seconds
        while True:
            if self.revision > after_revision:
                return self.get_latest_result()
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            await asyncio.sleep(min(1.0, remaining))

    async def _run(self):
        session = MicrolifeSession()
        session.latest_callback = self.record_latest_result
        try:
            while True:
                device = await session.find_device()
                if not device:
                    await asyncio.sleep(RECONNECT_DELAY_SEC)
                    continue

                try:
                    await session.run_connected_session(device)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    print(f"[-] Session error ({type(exc).__name__}): {exc!r}")

                if session.latest_reading:
                    self.record_latest_result(session.latest_reading)

                await asyncio.sleep(RECONNECT_DELAY_SEC)
        except asyncio.CancelledError:
            if session.latest_reading:
                self.record_latest_result(session.latest_reading)
            print("[*] Blood pressure monitor stopped.")
            raise



async def main():
    session = MicrolifeSession()
    print("Microlife BP monitor watcher started.")
    print("Tip: after a reading, hold Start ~8s if Bluetooth does not auto-wake.")
    print("Press Ctrl+C to stop.\n")

    try:
        while True:
            device = await session.find_device()
            if not device:
                print("[-] Monitor not found. Retrying...")
                await asyncio.sleep(RECONNECT_DELAY_SEC)
                continue

            try:
                await session.run_connected_session(device)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[-] Session error ({type(exc).__name__}): {exc!r}")

            print(f"[*] Reconnecting in {RECONNECT_DELAY_SEC:.0f}s...")
            await asyncio.sleep(RECONNECT_DELAY_SEC)
    except KeyboardInterrupt:
        print("\n[+] Stopped by user.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[+] Stopped by user.")
