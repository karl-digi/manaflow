# CMUX Proxy - GCP Deployment Guide

This guide explains how to deploy the cmux-proxy server to a GCP VM in us-central1.

## Overview

cmux-proxy is a Node.js/Bun-based proxy server that provides the same functionality as the Cloudflare edge-router but runs on a GCP VM. It handles:
- Port-based routing (port-{port}-{morphId}.cmux.app)
- Cmux-prefixed routing (cmux-{morphId}-{scope}-{port}.cmux.app)
- Workspace routing ({workspace}-{port}-{vmSlug}.cmux.app)
- HTML rewriting with service worker injection
- JavaScript location API interception
- WebSocket passthrough
- Loopback URL rewriting

## Prerequisites

### GCP Credentials Required
- **GCP Project ID**: Your Google Cloud project
- **Service Account**: A service account with the following roles:
  - Compute Admin (to create and manage VM instances)
  - Service Account User (to attach service accounts to VMs)
- **Service Account Key**: JSON key file for authentication

### Local Requirements
- [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install) installed
- Docker (for local testing)
- Bun (for local development)

## Local Testing

### Run with Bun
```bash
cd apps/cmux-proxy
bun install
bun run dev
```

The server will start on `http://localhost:3000`

### Run with Docker
```bash
cd apps/cmux-proxy

# Build the image
docker build -t cmux-proxy .

# Run the container
docker run -p 3000:3000 --name cmux-proxy cmux-proxy

# Or use docker-compose
docker-compose up
```

### Run Tests
```bash
cd apps/cmux-proxy
bun run test
```

### Health Check
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-11T..."
}
```

## GCP Deployment

### Step 1: Setup GCP Authentication

```bash
# Login to GCP
gcloud auth login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# Create a service account (if you don't have one)
gcloud iam service-accounts create cmux-proxy-sa \
  --display-name="CMUX Proxy Service Account"

# Grant necessary permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:cmux-proxy-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"

# Create and download key
gcloud iam service-accounts keys create ~/cmux-proxy-key.json \
  --iam-account=cmux-proxy-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### Step 2: Build and Push Docker Image

```bash
cd apps/cmux-proxy

# Authenticate Docker with GCR
gcloud auth configure-docker

# Build the image
docker build -t gcr.io/YOUR_PROJECT_ID/cmux-proxy:latest .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/cmux-proxy:latest
```

### Step 3: Create a GCP VM Instance

```bash
# Create a VM in us-central1
gcloud compute instances create-with-container cmux-proxy-vm \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --container-image=gcr.io/YOUR_PROJECT_ID/cmux-proxy:latest \
  --container-restart-policy=always \
  --container-env=PORT=3000,NODE_ENV=production \
  --tags=http-server,https-server \
  --scopes=https://www.googleapis.com/auth/cloud-platform

# Create firewall rules to allow HTTP/HTTPS traffic
gcloud compute firewall-rules create allow-cmux-proxy \
  --allow=tcp:3000,tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --description="Allow traffic to cmux-proxy"
```

### Step 4: Setup External IP (Optional but Recommended)

```bash
# Reserve a static external IP
gcloud compute addresses create cmux-proxy-ip --region=us-central1

# Get the IP address
gcloud compute addresses describe cmux-proxy-ip --region=us-central1 --format="get(address)"

# Update DNS records for *.cmux.app to point to this IP
```

### Step 5: Setup Load Balancer with SSL (Production)

For production, you'll want to setup a load balancer with SSL termination:

```bash
# Create a health check
gcloud compute health-checks create http cmux-proxy-health-check \
  --port=3000 \
  --request-path=/health \
  --check-interval=10s \
  --timeout=5s \
  --unhealthy-threshold=2 \
  --healthy-threshold=2

# Create instance group
gcloud compute instance-groups unmanaged create cmux-proxy-group \
  --zone=us-central1-a

gcloud compute instance-groups unmanaged add-instances cmux-proxy-group \
  --zone=us-central1-a \
  --instances=cmux-proxy-vm

# Create backend service
gcloud compute backend-services create cmux-proxy-backend \
  --protocol=HTTP \
  --health-checks=cmux-proxy-health-check \
  --global

gcloud compute backend-services add-backend cmux-proxy-backend \
  --instance-group=cmux-proxy-group \
  --instance-group-zone=us-central1-a \
  --global

# Create URL map
gcloud compute url-maps create cmux-proxy-url-map \
  --default-service=cmux-proxy-backend

# Create HTTP(S) proxy
gcloud compute target-http-proxies create cmux-proxy-http-proxy \
  --url-map=cmux-proxy-url-map

# Create HTTPS proxy (requires SSL certificate)
gcloud compute ssl-certificates create cmux-proxy-ssl-cert \
  --domains=*.cmux.app,cmux.app \
  --global

gcloud compute target-https-proxies create cmux-proxy-https-proxy \
  --ssl-certificates=cmux-proxy-ssl-cert \
  --url-map=cmux-proxy-url-map

# Create forwarding rules
gcloud compute forwarding-rules create cmux-proxy-http-rule \
  --global \
  --target-http-proxy=cmux-proxy-http-proxy \
  --ports=80

gcloud compute forwarding-rules create cmux-proxy-https-rule \
  --global \
  --target-https-proxy=cmux-proxy-https-proxy \
  --ports=443
```

## Deployment Scripts

### deploy.sh

Create a deployment script:

```bash
#!/bin/bash
set -e

PROJECT_ID="YOUR_PROJECT_ID"
REGION="us-central1"
ZONE="us-central1-a"
IMAGE_NAME="gcr.io/${PROJECT_ID}/cmux-proxy:latest"

echo "Building Docker image..."
docker build -t ${IMAGE_NAME} .

echo "Pushing to GCR..."
docker push ${IMAGE_NAME}

echo "Updating VM instance..."
gcloud compute instances update-container cmux-proxy-vm \
  --zone=${ZONE} \
  --container-image=${IMAGE_NAME}

echo "Deployment complete!"
```

### scale.sh

Create a scaling script for high availability:

```bash
#!/bin/bash
set -e

PROJECT_ID="YOUR_PROJECT_ID"
REGION="us-central1"
MIN_REPLICAS=2
MAX_REPLICAS=10

echo "Creating instance template..."
gcloud compute instance-templates create-with-container cmux-proxy-template \
  --container-image=gcr.io/${PROJECT_ID}/cmux-proxy:latest \
  --machine-type=e2-medium \
  --region=${REGION} \
  --container-restart-policy=always \
  --tags=http-server,https-server

echo "Creating managed instance group..."
gcloud compute instance-groups managed create cmux-proxy-mig \
  --base-instance-name=cmux-proxy \
  --template=cmux-proxy-template \
  --size=${MIN_REPLICAS} \
  --region=${REGION}

echo "Setting up autoscaling..."
gcloud compute instance-groups managed set-autoscaling cmux-proxy-mig \
  --region=${REGION} \
  --min-num-replicas=${MIN_REPLICAS} \
  --max-num-replicas=${MAX_REPLICAS} \
  --target-cpu-utilization=0.6

echo "Scaling setup complete!"
```

## Monitoring and Logging

### View Logs

```bash
# View container logs
gcloud compute instances get-serial-port-output cmux-proxy-vm --zone=us-central1-a

# Or SSH into the VM and check Docker logs
gcloud compute ssh cmux-proxy-vm --zone=us-central1-a
docker logs $(docker ps -q --filter ancestor=gcr.io/YOUR_PROJECT_ID/cmux-proxy)
```

### Setup Cloud Monitoring

```bash
# Enable Cloud Monitoring API
gcloud services enable monitoring.googleapis.com

# Create uptime check
gcloud monitoring uptime-checks create http cmux-proxy-uptime \
  --resource-type=uptime-url \
  --host=YOUR_EXTERNAL_IP \
  --path=/health \
  --port=3000
```

## Environment Variables

The following environment variables can be configured:

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (production/development)

## Troubleshooting

### Server won't start
1. Check Docker logs: `docker logs <container_id>`
2. Verify port 3000 is not in use
3. Check environment variables

### Can't connect to VM
1. Verify firewall rules are configured correctly
2. Check VM status: `gcloud compute instances list`
3. Verify external IP is accessible

### Health check failing
1. Test health endpoint: `curl http://EXTERNAL_IP:3000/health`
2. Check if server is running: `gcloud compute ssh cmux-proxy-vm --command="docker ps"`

### High CPU usage
1. Check metrics in Cloud Console
2. Consider scaling horizontally with managed instance groups
3. Increase VM machine type

## Costs Estimation

Approximate monthly costs for us-central1:

- **Single e2-medium VM**: ~$25/month
- **Static IP**: ~$7/month
- **Load Balancer**: ~$18/month + traffic costs
- **Container Registry**: ~$0.10/GB/month
- **Network egress**: Varies by traffic (~$0.12/GB to internet)

Total estimated cost: **$50-100/month** depending on traffic.

## Security Considerations

1. **Firewall Rules**: Only open necessary ports (80, 443, 3000)
2. **Service Account**: Use minimal permissions principle
3. **SSL/TLS**: Always use HTTPS in production
4. **Updates**: Regularly update Docker image with security patches
5. **Monitoring**: Set up alerts for unusual traffic patterns

## Next Steps

1. Set up DNS records for *.cmux.app to point to your GCP load balancer
2. Configure SSL certificates for HTTPS
3. Set up Cloud Monitoring and alerting
4. Implement backup and disaster recovery plan
5. Set up CI/CD pipeline for automated deployments

## Support

For issues or questions:
- Check logs first: `gcloud compute instances get-serial-port-output cmux-proxy-vm`
- Review health endpoint: `curl http://EXTERNAL_IP:3000/health`
- SSH into VM for debugging: `gcloud compute ssh cmux-proxy-vm`
