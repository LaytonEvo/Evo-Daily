# Switching on attachments

Comments work as plain text with none of this. Attachments need a bucket.

Built against **Cloudflare R2**, but any S3-compatible bucket works — the app
only speaks the S3 API. R2 is the recommendation because it has no egress fees,
which is the charge that catches people out when a bucket holds photos.

## 1. Make the bucket

Cloudflare dashboard → **R2** → **Create bucket**. Name it something like
`evotasks-attachments`. Keep it **private** — the app hands out short-lived
signed links, so nothing needs to be publicly readable.

## 2. Allow the browser to upload to it

Files go **browser → bucket** directly; they never pass through the app. That
keeps large uploads off the Next.js server, which on Railway is the thing that
falls over first. It does mean the bucket has to accept a cross-origin PUT.

R2 → your bucket → **Settings** → **CORS Policy**:

```json
[
  {
    "AllowedOrigins": ["https://evotasks-web-production.up.railway.app"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3000
  }
]
```

Miss this step and uploads fail silently in the browser console while
everything else looks fine.

## 3. Create an API token

R2 → **Manage API Tokens** → **Create API Token**, with **Object Read & Write**
scoped to this one bucket. Copy the Access Key ID and Secret Access Key — the
secret is shown once.

## 4. Set the variables

In Railway, on `evotasks-web`:

```
S3_BUCKET=evotasks-attachments
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
```

The account ID is in the R2 overview page URL. Set these in the dashboard, not
in a file.

The **Attach** button appears once all four are set, and disappears if they are
removed — comments carry on either way.

## What is allowed

10MB a file. JPEG, PNG, GIF, WebP, HEIC, PDF, plain text and CSV.

The list is deliberate rather than a wildcard: an uploaded `.html` or `.svg`
served back from our own origin would run as our origin.

## How access works

Nothing in the bucket is public. A download goes through `/api/attachments/:id`,
which checks the requester can see the underlying task and then redirects to a
signed URL that expires in five minutes.

That URL is a bearer token in a query string — anyone it is forwarded to can
read the file until it expires. Five minutes is the tradeoff: long enough for a
click, short enough that a pasted link goes stale.

Storage keys are minted server-side from a UUID and prefixed with the
organisation id. The client never chooses a key, and a key that does not match
the caller's organisation is refused — a client-chosen path is both a traversal
hole and a way to guess at someone else's file.

Deleting a comment deletes its attachments, rows first and bytes after, so a
storage outage cannot leave a comment undeletable. The worst case is an orphaned
object costing a fraction of a penny.
