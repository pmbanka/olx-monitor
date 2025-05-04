#!/bin/bash

echo "Using Node version from .nvmrc..."
nvm install
nvm use

echo "Installing exact dependencies from package-lock.json..."
npm ci