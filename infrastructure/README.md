# SharkPark Infrastructure

AWS serverless architecture with a **tiered approach**: start lean, scale when needed.

---

## Deployment Tiers

| Tier | When to Use | Monthly Cost | Services |
|------|-------------|--------------|----------|
| **Tier 1: Launch** | 0-1,000 users | $0-10 | Lambda, API Gateway, DynamoDB |
| **Tier 2: Growth** | 1,000-5,000 users | $20-50 | + CloudFront, S3 |
| **Tier 3: Scale** | 5,000+ users | $50-150+ | + ElastiCache, WAF, X-Ray |

**Start with Tier 1. Add services only when you see the need.**

---

## Tier 1: Launch Architecture (Recommended Start)

Minimal viable infrastructure. **Nearly free with AWS Free Tier.**

```
┌──────────────┐         ┌─────────────────────────┐         ┌──────────────────────┐
│  Mobile App  │ ──────► │     API Gateway         │ ──────► │   Lambda (NestJS)    │
│  (iOS/Android)         │  - HTTPS/TLS            │         │   - Single function  │
└──────────────┘         │  - Basic rate limiting  │         │   - All routes       │
                         └─────────────────────────┘         └──────────┬───────────┘
                                                                        │
                                                                        ▼
                                                             ┌──────────────────────┐
                                                             │  DynamoDB (On-Demand)│
                                                             │  - sharkpark-main    │
                                                             │  - sharkpark-timeseries
                                                             │  - Pay per request   │
                                                             └──────────────────────┘
                                                                        │
                                                                  Azure AD
                                                              (CSULB SSO - free)
```

### Tier 1 Services

| Service | Purpose | Free Tier | After Free Tier |
|---------|---------|-----------|-----------------|
| **Lambda** | API handlers | 1M requests/month | ~$0.20/1M requests |
| **API Gateway** | REST API | 1M requests/month | ~$3.50/1M requests |
| **DynamoDB** | Database | 25GB + 25 RCU/WCU | Pay per request |
| **CloudWatch** | Logs | 5GB logs/month | ~$0.50/GB |

**Estimated cost: $0-5/month** (mostly free tier)

### What You Get
- ✅ Auto-scaling (handles 0 to thousands of users)
- ✅ HTTPS/SSL included
- ✅ Basic rate limiting (10,000 req/sec default)
- ✅ Pay only for what you use
- ✅ No servers to manage

### What You Don't Get (Yet)
- ❌ Edge caching (add CloudFront in Tier 2)
- ❌ Advanced DDoS protection (add WAF in Tier 3)
- ❌ Sub-millisecond caching (add ElastiCache in Tier 3)
- ❌ Distributed tracing (add X-Ray in Tier 3)

---

## Tier 2: Growth Architecture

Add when you have **consistent traffic** and need **caching + storage**.

```
                         ┌─────────────────────────┐
                         │      CloudFront CDN     │ ◄── Cache static responses
                         │  - Edge caching         │
                         │  - Basic DDoS protection│
                         └───────────┬─────────────┘
                                     │
┌──────────────┐         ┌───────────▼─────────────┐         ┌──────────────────────┐
│  Mobile App  │ ──────► │     API Gateway         │ ──────► │   Lambda (NestJS)    │
└──────────────┘         └─────────────────────────┘         └──────────┬───────────┘
                                                                        │
                                                    ┌───────────────────┼───────────────────┐
                                                    │                   │                   │
                                         ┌──────────▼──────┐  ┌─────────▼─────────┐  ┌──────▼──────┐
                                         │    DynamoDB     │  │    S3 Bucket      │  │  Azure AD   │
                                         │  (On-Demand)    │  │  - ML training    │  │  (Auth)     │
                                         └─────────────────┘  │  - Data archive   │  └─────────────┘
                                                              └───────────────────┘
```

### Added in Tier 2

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **CloudFront** | CDN + edge caching | ~$1-5 |
| **S3** | ML data + archives | ~$1-3 |

**Estimated cost: $10-30/month**

### When to Upgrade to Tier 2
- Response times > 200ms for cached data
- Need to store ML training data
- Want basic DDoS protection

---

## Tier 3: Scale Architecture

Add when you have **thousands of daily users** and need **performance optimization**.

```
                         ┌─────────────────────────┐
                         │      CloudFront CDN     │
                         └───────────┬─────────────┘
                                     │
                         ┌───────────▼─────────────┐
                         │        AWS WAF          │ ◄── SQL injection, XSS, rate limiting
                         └───────────┬─────────────┘
                                     │
┌──────────────┐         ┌───────────▼─────────────┐         ┌──────────────────────┐
│  Mobile App  │ ──────► │     API Gateway         │ ──────► │   Lambda (NestJS)    │
└──────────────┘         └─────────────────────────┘         └──────────┬───────────┘
                                                                        │
                              ┌─────────────────────────────────────────┼─────────────────┐
                              │                     │                   │                 │
                   ┌──────────▼──────────┐ ┌───────▼───────┐ ┌─────────▼─────────┐ ┌─────▼─────┐
                   │  ElastiCache Redis  │ │   DynamoDB    │ │        S3         │ │  Azure AD │
                   │  - Hot data cache   │ │  (On-Demand)  │ │  - ML pipeline    │ │  (Auth)   │
                   │  - Sub-ms reads     │ │  + PITR       │ │  - Archives       │ └───────────┘
                   │  - Reliability scores│ │  + Streams   │ └───────────────────┘
                   └─────────────────────┘ └───────────────┘
                                                  │
                                                  ▼
                                     ┌────────────────────────┐
                                     │   DynamoDB Streams     │
                                     │   → Lambda triggers    │
                                     │   → ML pipeline        │
                                     └────────────────────────┘
```

### Added in Tier 3

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **ElastiCache Redis** | Sub-ms caching | ~$15 (t4g.micro) |
| **AWS WAF** | Advanced security | ~$5-10 |
| **DynamoDB PITR** | Point-in-time recovery | ~$2-5 |
| **DynamoDB Streams** | Event-driven updates | ~$1-2 |
| **X-Ray** | Distributed tracing | ~$5 |
| **Secrets Manager** | Secure credentials | ~$1 |

**Estimated cost: $50-100/month**

### When to Upgrade to Tier 3
- 5,000+ daily active users
- Need sub-10ms response times
- Security compliance requirements
- Debugging complex performance issues

---

## Cost Comparison

| Users | Tier 1 | Tier 2 | Tier 3 |
|-------|--------|--------|--------|
| 0 | $0 | $5 | $30 |
| 100 | $1 | $7 | $35 |
| 1,000 | $5 | $15 | $50 |
| 5,000 | $15 | $35 | $80 |
| 10,000 | $30 | $60 | $120 |

**Recommendation**: Start Tier 1, upgrade when you hit limits.

---

## Essential Services (All Tiers)

### Lambda + API Gateway
Your NestJS backend runs here. Zero cost when idle.

```typescript
// Deployed as a single Lambda function
// NestJS handles all routing internally
export const handler = serverlessExpress({ app });
```

### DynamoDB (On-Demand)
Pay-per-request pricing. No capacity planning needed.

| Table | Purpose | TTL |
|-------|---------|-----|
| `sharkpark-main` | Lots, users, config | No |
| `sharkpark-timeseries` | Occupancy events, snapshots | 90 days |

### Azure AD (Authentication)
Keep using Azure AD - it's free through CSULB and already works.

```
Mobile App → Azure AD (CSULB SSO) → JWT Token → API Gateway → Lambda
```

---

## DynamoDB Schema

### sharkpark-main
Primary table for lots, users, and configuration.

| Partition Key | Sort Key | Example |
|--------------|----------|---------|
| `PK` | `SK` | `LOT#G1` / `METADATA` |

Access Patterns:
- `PK=LOT#<lot_id>` → Get lot details
- `PK=USER#<user_id>` → Get user profile
- `GSI1: type-index` → Query all lots

### sharkpark-timeseries
Time-series data for occupancy events and snapshots.

| Partition Key | Sort Key | TTL |
|--------------|----------|-----|
| `PK` | `timestamp` | 90 days |

Access Patterns:
- `PK=OCCUPANCY#<lot_id>` → Get occupancy history
- `PK=SNAPSHOT#<lot_id>` → Get hourly snapshots

---

## Security (All Tiers)

### Tier 1 Security (Included)
- ✅ HTTPS/TLS (API Gateway default)
- ✅ Azure AD JWT validation
- ✅ IAM least-privilege roles
- ✅ Basic rate limiting (10k req/sec)

### Tier 3 Security (Optional)
- ☐ AWS WAF (SQL injection, XSS)
- ☐ Secrets Manager (credentials)
- ☐ CloudFront geo-blocking

### Authentication Flow
```
Mobile App → Azure AD (CSULB SSO) → Access Token
     │
     └──► API Gateway → Lambda validates JWT → DynamoDB
```

- Access token expiry: 1 hour
- Refresh token rotation enabled
- Secure storage: iOS Keychain / Android Keystore

---

## Environments

| Environment | Database | Tier |
|-------------|----------|------|
| `dev` | DynamoDB Local (Docker) | Local |
| `staging` | DynamoDB (On-Demand) | Tier 1 |
| `prod` | DynamoDB (On-Demand) | Tier 1-3 |

---

## Deployment (CDK)

Infrastructure as Code using **AWS CDK** (TypeScript):

```bash
# Install CDK
npm install -g aws-cdk

# Bootstrap (first time only)
cdk bootstrap

# Deploy
cdk deploy SharkparkStack --context tier=1
```

### CDK Project Structure (To Create)
```
infrastructure/
├── bin/
│   └── app.ts              # Entry point
├── lib/
│   ├── tier1-stack.ts      # Lambda + API Gateway + DynamoDB
│   ├── tier2-stack.ts      # + CloudFront + S3
│   └── tier3-stack.ts      # + ElastiCache + WAF
├── cdk.json
├── package.json
└── tsconfig.json
```

---

## CI/CD Pipeline

```
GitHub Push → GitHub Actions → Build & Test → CDK Deploy
                    │
                    ├── pnpm test (backend)
                    ├── pnpm test (mobile)
                    ├── pnpm lint
                    └── cdk deploy (on main branch)
```

---

## Local Development

```bash
# Start local DynamoDB
docker-compose -f docker/docker-compose.yml up -d

# Seed database
pnpm run seed

# Start backend
cd apps/backend && pnpm dev

# Start mobile
cd apps/mobile && pnpm start
```

---

## ML Pipeline (Future - Tier 2+)

When ready for ML predictions:

```
DynamoDB (occupancy_events)
         │
         ▼
    S3 Bucket (training data)
         │
         ▼
    SageMaker (model training)
         │
         ▼
    Lambda (inference endpoint)
         │
         ▼
    API → Mobile App (predictions)
```

**Trigger**: When you have 30+ days of occupancy event data.

---

## Quick Reference

### Tier 1 Checklist (Launch)
- [ ] Create AWS account
- [ ] Set up CDK project
- [ ] Deploy Lambda + API Gateway
- [ ] Create DynamoDB tables
- [ ] Configure Azure AD app registration
- [ ] Test mobile app against staging

### Upgrade Triggers

| Symptom | Solution |
|---------|----------|
| Response times > 200ms | Add CloudFront (Tier 2) |
| Need ML training data | Add S3 (Tier 2) |
| 5,000+ DAU | Add ElastiCache (Tier 3) |
| Security audit required | Add WAF (Tier 3) |
| Debugging performance | Add X-Ray (Tier 3) |
