# Public bundle report

The report measures the entry module and each static JavaScript import required before route interaction. Dynamic route chunks are separate.

| Build | Initial raw bytes | Initial gzip bytes | Initial chunks |
| --- | ---: | ---: | ---: |
| Normal | 1,001,709 | 266,428 | 1 |
| Demo | 995,175 | 265,035 | 1 |

The parent demo build used 1,083,709 raw bytes and 286,942 gzip bytes before the route split. The split removes 88,534 raw bytes and 21,907 gzip bytes from that initial graph.

The largest deferred chunk is the admin application. It uses 174,396 raw bytes and 48,340 gzip bytes in the demo build.

## Enforced limits

- The initial graph can use at most 1,020,000 raw bytes and 275,000 gzip bytes.
- Each deferred chunk can use at most 180,000 raw bytes and 50,000 gzip bytes.
- CI checks the normal build and the committed demo build.
