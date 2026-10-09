"""Локальный сервер квиза: обычная раздача файлов, но без кэша —
чтобы после правок паков браузер сразу видел новую версию.

Плюс поддержка Range-запросов: без неё браузер не может перемотать
локальный mp3/mp4 из media/ к началу фрагмента и играет его с нуля."""
import functools
import http.server
import os
import re
import sys

RANGE_RE = re.compile(r'bytes=(\d*)-(\d*)$')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def send_head(self):
        self.range_left = None
        m = RANGE_RE.match(self.headers.get('Range', '').strip())
        path = self.translate_path(self.path)
        if not m or m.groups() == ('', '') or os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None
        size = os.fstat(f.fileno()).st_size
        first, last = m.groups()
        if first == '':  # bytes=-500 — последние 500 байт
            start, end = max(0, size - int(last)), size - 1
        else:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        if start > end:
            f.close()
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        f.seek(start)
        self.range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        try:
            if self.range_left is None:
                return super().copyfile(source, outputfile)
            left = self.range_left
            while left > 0:
                chunk = source.read(min(64 * 1024, left))
                if not chunk:
                    break
                outputfile.write(chunk)
                left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # браузер сам обрывает лишние куски видео при перемотке — это нормально


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'Квиз на диване: http://localhost:{port}')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
