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
