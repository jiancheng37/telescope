# AWS analysis architecture

Telescope's web application does not run the LLM pipeline. It creates a durable
`AnalysisJob`, gives the signed-in browser a 15-minute S3 upload URL, verifies the
upload, and sends only `{ "jobId": "..." }` to SQS. An ECS Fargate worker consumes
the job, runs the existing analysis pipeline, saves the report, and deletes the
raw export. S3 also expires every raw upload after one day as a cleanup backstop.

```text
Browser -> Vercel/Next.js -> Prisma Postgres
   |             |
   |             +-> SQS -> ECS Fargate worker -> OpenAI
   |                         |          |
   +-> private S3 upload ----+----------+-> delete raw export
```

## AWS resources

[`infra/aws/analysis-stack.yml`](../infra/aws/analysis-stack.yml) creates:

- a private, encrypted S3 bucket with CORS for both the public site and authenticated app origins, plus one-day expiration;
- an encrypted SQS queue and dead-letter queue;
- an ECR repository;
- an ECS cluster, task definition, service, logs, and task roles;
- a least-privilege IAM user for the Vercel deployment.

The stack expects public subnets and a security group with outbound HTTPS (443)
and PostgreSQL (5432) access. No inbound rule or load balancer is needed because
the worker polls SQS and has no HTTP API.

## Deployment order

1. Create two AWS Secrets Manager plaintext secrets: one containing the pooled
   `DATABASE_URL`, and one containing `OPENAI_API_KEY`.
2. Deploy the CloudFormation stack with `WorkerDesiredCount=0` and
   `CAPABILITY_NAMED_IAM`. No container is started during this first deployment.
3. Build and push `Dockerfile.worker` to the created ECR repository, then update
   the stack with that immutable `WorkerImageTag` and `WorkerDesiredCount=1`.
4. Create an access key for the output `VercelAnalysisUserName`; put the key only
   in Vercel's encrypted environment settings.
5. Add the stack outputs and credentials to Vercel.
6. Apply the Prisma migration before enabling the worker.

The worker image is built with:

```sh
docker build --platform linux/amd64 -f Dockerfile.worker -t telescope-analysis .
```

Tag and push it using the ECR login and repository commands shown in the AWS ECR
console. Use an immutable tag such as the Git commit SHA.

## Vercel environment

```text
DATABASE_URL                    pooled Prisma Postgres URL
DIRECT_URL                      direct Prisma Postgres migration URL
AWS_REGION                      stack region
AWS_S3_UPLOAD_BUCKET            UploadBucketName output
AWS_SQS_ANALYSIS_QUEUE_URL      AnalysisQueueUrl output
AWS_ACCESS_KEY_ID               Vercel analysis IAM access key
AWS_SECRET_ACCESS_KEY           Vercel analysis IAM secret key
TELESCOPE_MAX_EXPORT_BYTES      optional; defaults to 52428800
TELESCOPE_DAILY_ANALYSIS_LIMIT  optional; defaults to 3 per user per rolling day
UPSTASH_REDIS_REST_URL          shared API rate-limit store
UPSTASH_REDIS_REST_TOKEN        shared API rate-limit credential
```

Vercel's Upstash Marketplace integration names the same two values
`KV_REST_API_URL` and `KV_REST_API_TOKEN`; Telescope accepts either pair.

The OpenAI key is present only in the ECS task. It is not available to Next.js.

## ECS worker environment

CloudFormation supplies `AWS_REGION`, bucket, queue, model, database URL and
OpenAI key. AWS SDK credentials come from the ECS task role; never put static AWS
keys in the worker container.

## Required operational checks

- Set an S3 request metric/alarm and verify lifecycle expiration.
- Alarm on SQS oldest-message age and dead-letter queue depth.
- Alarm when the ECS service has fewer than one running task.
- Keep the SQS visibility timeout above the heartbeat interval. The worker extends
  visibility every minute while a job is active.
- Run a deletion test and verify raw exports disappear after success and failure.
- Rotate the Vercel IAM access key and OpenAI key periodically.
