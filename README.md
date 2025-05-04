Build:

```
docker build -t olx-monitor .
```

Run docker:

```
docker run --rm --env-file .env olx-monitor
```

Local:

```
./setup.sh
npm check-olx.js
```
