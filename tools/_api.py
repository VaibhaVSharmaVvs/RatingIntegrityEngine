"""Shared HTTP client for the tools: retries GETs when the API drops a connection.

The API is single-process; while a corpus stage or a Jev run is busy it can close an
idle keep-alive connection. GETs are idempotent, so retrying them is safe. Writes
(POST/PUT) are never retried.
"""

import time

import httpx

API = "http://localhost:8001"


class _RetryGets(httpx.HTTPTransport):
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        for attempt in range(6):
            try:
                return super().handle_request(request)
            except httpx.TransportError:
                if request.method != "GET" or attempt == 5:
                    raise
                time.sleep(1 + attempt)
        raise AssertionError("unreachable")


def client(timeout: float = 120) -> httpx.Client:
    return httpx.Client(base_url=API, timeout=timeout, transport=_RetryGets())
