#!/usr/bin/env bash
set -e
cp -R "$(dirname "$0")/fixture/." .
git init -q
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -q -m "Initial commit"
