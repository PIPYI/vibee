# dual-app

Two separate web applications that share a SQLite database: a user-facing app
lets users submit listings, and an admin-facing app lets admins approve or
reject them. Both apps run independently on different ports and read/write to
the same `listings.db` file.

This exists as a smoke-test fixture for `vibee`'s architecture-view pipeline —
demonstrating a multi-app pattern with a shared persistent data layer.

## Usage

Terminal 1 (Install dependencies and start User app):
```bash
npm install
npm start --prefix user-app
```

Terminal 2 (Start Admin app):
```bash
npm start --prefix admin-app
```

Terminal 3 (Submit listings via CLI):
```bash
# User app is at http://127.0.0.1:3500
# Admin app is at http://127.0.0.1:3501
curl -X POST http://127.0.0.1:3500/api/listings -H "content-type: application/json" -d '{"title":"old couch"}'
curl http://127.0.0.1:3500/api/listings
curl -X POST http://127.0.0.1:3501/api/listings/1/approve
curl http://127.0.0.1:3500/api/listings  # Should show approved status
```

Both apps access the same database, so listing status changes in the admin app
are immediately visible in the user app.
