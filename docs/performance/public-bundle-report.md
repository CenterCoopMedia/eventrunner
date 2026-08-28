# Public bundle report

The report measures the entry module and each static JavaScript import required before route interaction. Dynamic route chunks are separate.

| Build | Initial raw bytes | Initial gzip bytes | Initial chunks |
| --- | ---: | ---: | ---: |
| Normal | 1,001,687 | 266,419 | 1 |
| Demo | 995,153 | 265,011 | 1 |

The parent demo build used 1,083,709 raw bytes and 286,942 gzip bytes before the route split. The split removes 88,556 raw bytes and 21,931 gzip bytes from that initial graph.

The largest deferred chunk is the admin application. It uses 173,117 raw bytes and 47,880 gzip bytes in the demo build.

## Enforced limits

- The initial graph can use at most 1,020,000 raw bytes and 275,000 gzip bytes.
- Each deferred chunk can use at most 180,000 raw bytes and 50,000 gzip bytes.
- CI checks the normal build and the committed demo build.
