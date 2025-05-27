Build:

```
docker build -t olx-monitor .
```

Run docker:

```
docker run -v $(pwd)/listings:/app/listings --env-file .env olx-monitor
```

Local:

```
./setup.sh
npm check-olx.js
```

Make sure to create `.env` file. The schema is in `.env.example`.

For Gmail integration, use [app password](https://support.google.com/mail/answer/185833?hl=en), not your regular one.
