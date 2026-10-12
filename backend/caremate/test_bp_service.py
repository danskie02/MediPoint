import unittest

from test_bp import BloodPressureMonitorService, MicrolifeSession


class BloodPressureMonitorServiceTests(unittest.TestCase):
    def test_latest_result_stays_newest(self):
        service = BloodPressureMonitorService()
        service.latest = {"systolic": 118, "diastolic": 78, "pulse": 72}
        newer = {"systolic": 124, "diastolic": 82, "pulse": 74}
        service.record_latest_result(newer)
        self.assertEqual(service.get_latest_result(), newer)

    def test_identical_reading_does_not_advance_revision(self):
        service = BloodPressureMonitorService()
        reading = {"systolic": 118, "diastolic": 78, "pulse": 72}
        service.record_latest_result(reading)
        service.record_latest_result(reading)
        self.assertEqual(service.revision, 1)


class BloodPressureMonitorWaitTests(unittest.IsolatedAsyncioTestCase):
    async def test_wait_only_returns_readings_newer_than_start_revision(self):
        service = BloodPressureMonitorService()
        service.record_latest_result({"systolic": 118, "diastolic": 78, "pulse": 72})
        start_revision = service.revision

        self.assertIsNone(await service.wait_for_result(start_revision, timeout_seconds=0))

        newer = {"systolic": 124, "diastolic": 82, "pulse": 74}
        service.record_latest_result(newer)
        self.assertEqual(await service.wait_for_result(start_revision, timeout_seconds=0), newer)


class MicrolifeSessionTests(unittest.TestCase):
    def test_notification_handler_recovers_and_consumes_buffered_frames(self):
        def make_frame(payload):
            body = b"M:" + (len(payload) + 1).to_bytes(2, "big") + payload
            return body + bytes([sum(body) % 256])

        invalid_frame = bytearray(make_frame(b"broken"))
        invalid_frame[-1] ^= 0xFF
        valid_frame = make_frame(b"reading")
        session = MicrolifeSession()

        session.notification_handler(
            None, bytearray(b"noise" + invalid_frame + valid_frame[:3])
        )
        self.assertFalse(session.result_event.is_set())

        session.notification_handler(
            None, bytearray(valid_frame[3:] + make_frame(b"next"))
        )

        self.assertTrue(session.result_event.is_set())
        self.assertEqual(session.assembled_result, b"next")


if __name__ == "__main__":
    unittest.main()
