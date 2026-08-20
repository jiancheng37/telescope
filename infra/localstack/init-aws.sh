#!/bin/bash
set -euo pipefail

awslocal s3api create-bucket --bucket telescope-analysis-local 2>/dev/null || true
awslocal s3api put-bucket-cors \
  --bucket telescope-analysis-local \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["content-type"],
      "AllowedMethods": ["PUT"],
      "AllowedOrigins": ["http://localhost:3000"],
      "ExposeHeaders": ["etag"],
      "MaxAgeSeconds": 900
    }]
  }'

awslocal sqs create-queue --queue-name telescope-analysis >/dev/null

