"""Tests for backend.util.pathutil.sanitize_path()."""

from backend.util import sanitize_path


class TestSanitizePath:
    """Direct unit tests for the sanitize_path() helper."""

    def test_simple_relative_path(self, tmp_path):
        (tmp_path / "file.txt").touch()
        result = sanitize_path(tmp_path, "file.txt")
        assert result is not None
        assert result.is_relative_to(tmp_path)

    def test_nested_relative_path(self, tmp_path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "file.txt").touch()
        result = sanitize_path(tmp_path, "sub/file.txt")
        assert result is not None
        assert result.is_relative_to(tmp_path)

    def test_dotdot_traversal_blocked(self, tmp_path):
        result = sanitize_path(tmp_path, "../../../etc/passwd")
        assert result is None

    def test_absolute_path_outside_root_blocked(self, tmp_path):
        result = sanitize_path(tmp_path, "/etc/passwd")
        assert result is None

    def test_absolute_path_inside_root_rejected(self, tmp_path):
        # Absolute input is rejected even when it points inside root: callers
        # address files by relative name only. Trusted, already-confined paths
        # are loaded directly, not routed back through sanitize_path.
        (tmp_path / "ok.txt").touch()
        abs_path = str(tmp_path / "ok.txt")
        assert sanitize_path(tmp_path, abs_path) is None

    def test_tilde_prefix_rejected(self, tmp_path):
        assert sanitize_path(tmp_path, "~/secrets.txt") is None
        assert sanitize_path(tmp_path, "~root/.bashrc") is None

    def test_dotdot_that_stays_inside_root(self, tmp_path):
        sub = tmp_path / "a" / "b"
        sub.mkdir(parents=True)
        result = sanitize_path(tmp_path, "a/b/../../a/b")
        assert result is not None
        assert result.is_relative_to(tmp_path)

    def test_dotdot_component_check_no_false_positive(self, tmp_path):
        """Names starting with '..' but not a traversal should be handled."""
        result = sanitize_path(tmp_path, "..well-known")
        if result is not None:
            assert result.is_relative_to(tmp_path)

    def test_null_byte_blocked(self, tmp_path):
        """Null bytes in filenames should not bypass checks."""
        result = sanitize_path(tmp_path, "file\x00.txt")
        assert result is None

    def test_symlink_escape_blocked(self, tmp_path):
        """Symlinks pointing outside root should be caught by resolve()."""
        link = tmp_path / "escape"
        link.symlink_to("/etc")
        result = sanitize_path(tmp_path, "escape/passwd")
        assert result is None

    def test_empty_filename_safe(self, tmp_path):
        result = sanitize_path(tmp_path, "")
        if result is not None:
            assert result.is_relative_to(tmp_path)

    def test_dot_resolves_to_root(self, tmp_path):
        result = sanitize_path(tmp_path, ".")
        if result is not None:
            assert result.is_relative_to(tmp_path)
