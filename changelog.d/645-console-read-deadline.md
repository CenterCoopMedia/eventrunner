### Fixed

- Console reads stop waiting after 30 seconds and offer a plain error so the read can be tried again. The deadline covers sign-in confirmation, the request and its response body. Writes remain untimed because a request may still finish after the browser stops waiting (#645).
