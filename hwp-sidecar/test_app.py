import unittest

from safe_filename import safe_upload_name


class SafeUploadNameTest(unittest.TestCase):
    def test_keeps_only_basename_for_path_like_upload_names(self) -> None:
        self.assertEqual(safe_upload_name("../outside/report.hwp"), "report.hwp")
        self.assertEqual(safe_upload_name("..\\outside\\report.hwp"), "report.hwp")

    def test_uses_stable_fallback_for_empty_upload_name(self) -> None:
        self.assertEqual(safe_upload_name(None), "input")
        self.assertEqual(safe_upload_name(".."), "input")


if __name__ == "__main__":
    unittest.main()
