# Requirements

## Runtime

- Node.js `>= 18`
- npm (project is pinned to `npm@11.8.0` in `package.json`)

## Python / pip

This repository does not include Python application code and does not require
Python packages for the feed generator runtime.

You can still run:

```powershell
pip install -r requirements.txt
```

It will complete without installing extra packages because `requirements.txt`
is intentionally empty of Python dependencies.

## Install all project dependencies

Use npm for the actual service dependencies:

```powershell
npm.cmd install
```

## Verify install

```powershell
npm.cmd run build
npm.cmd run start
```
