"""File validation utilities for document uploads."""

# Magic bytes for accepted document types
MAGIC_SIGNATURES = [
    (b'%PDF', 'application/pdf'),
    (b'\xff\xd8\xff', 'image/jpeg'),
    (b'\x89PNG\r\n\x1a\n', 'image/png'),
    (b'GIF8', 'image/gif'),
    (b'ID3', 'audio/mpeg'),
    (b'\xff\xfb', 'audio/mpeg'),
    (b'\xff\xf3', 'audio/mpeg'),
    (b'\xff\xf2', 'audio/mpeg'),
    (b'RIFF', 'audio/wav'),
    (b'OggS', 'audio/ogg'),
    (b'fLaC', 'audio/flac'),
]

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def validate_file_size(file_obj):
    """Returns (is_valid, error_message)."""
    size = getattr(file_obj, 'size', None)
    if size is not None:
        if size == 0:
            return False, "File is empty."
        if size > MAX_FILE_SIZE:
            return False, "File size exceeds 50MB limit."
    return True, ""


def validate_file_magic_bytes(file_obj):
    """Returns (is_valid, error_message). Reads first 16 bytes."""
    try:
        file_obj.seek(0)
        header = file_obj.read(16)
        file_obj.seek(0)
    except Exception:
        return False, "Could not read file."

    if not header:
        return False, "File is empty."

    for magic, _ in MAGIC_SIGNATURES:
        if header[:len(magic)] == magic:
            return True, ""

    return False, "File type not supported. Upload a PDF, image, or audio file."
