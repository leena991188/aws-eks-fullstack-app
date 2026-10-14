

\# AWS EKS Full Stack Application



A starter application with React, Node.js microservices, PostgreSQL,

DynamoDB, private S3 uploads, Secrets Manager, and EKS manifests.



\## Prerequisites



\- Node.js 22+

\- Docker Desktop and Docker Compose

\- AWS CLI configured for your development account

\- An AWS account with permission to create the required resources

\- kubectl and eksctl for EKS deployment



\## 1. Start the frontend locally



Open a terminal:



&#x20;   cd frontend

&#x20;   npm install

&#x20;   npm run dev



Open the local URL shown by Vite, usually http://localhost:5173.



The frontend uses relative /api URLs by default. For local development,

configure a Vite proxy or access the backend through a local reverse proxy.



\## 2. Configure local environment



From the project root:



&#x20;   cp .env.example .env



Edit .env and set DB\_PASSWORD, JWT\_SECRET, AWS\_REGION, and UPLOAD\_BUCKET.



Do not commit .env or use these local credentials in EKS.



\## 3. Start the backend



From the project root:



&#x20;   docker compose up --build



The backend services expose:



\- Auth: http://localhost:3001

\- Users: http://localhost:3002

\- Files: http://localhost:3003

\- Admin: http://localhost:3004



The auth and admin services use the local PostgreSQL container.

The user and file services also need AWS credentials and access to

DynamoDB and the configured S3 bucket.



For local containers, configure an AWS profile mount or another

secure AWS credential mechanism. Do not bake credentials into images.



\## 4. Create AWS resources



Create a private S3 bucket for uploads and enable S3 Block Public Access.



Create an RDS PostgreSQL database reachable from the EKS worker/pod

network. Allow port 5432 only from the application security group or

appropriate private network sources.



Create a Secrets Manager secret containing JSON such as:



&#x20;   {"JWT\_SECRET":"replace-with-a-long-random-secret-value"}



Use the secret ARN in JWT\_SECRET\_ARN.



The DynamoDB profile table is named app-user-profiles by default.

The demo user service attempts to create it when it does not exist.

For production, create the table in infrastructure-as-code and remove

table-creation permissions from the runtime role.



\## 5. Create a first admin



Register an account through the frontend. Then connect to the PostgreSQL

database as an authorized database administrator and run:



&#x20;   UPDATE app\_users

&#x20;   SET role = 'admin'

&#x20;   WHERE email = 'your-admin-email@example.com';



Log out and log in again so a new JWT contains the admin role.



Never expose database administrator credentials to the frontend.



\## 6. Build and push the backend images



Set your AWS account ID and region:



&#x20;   export AWS\_REGION=ap-southeast-2

&#x20;   export AWS\_ACCOUNT\_ID=$(aws sts get-caller-identity --query Account --output text)



Authenticate Docker with ECR:



&#x20;   aws ecr get-login-password --region "$AWS\_REGION" \\

&#x20;     | docker login --username AWS --password-stdin \\

&#x20;       "$AWS\_ACCOUNT\_ID.dkr.ecr.$AWS\_REGION.amazonaws.com"



Create one ECR repository per service:



&#x20;   for service in auth-service user-service file-service admin-service; do

&#x20;     aws ecr describe-repositories \\

&#x20;       --repository-names "$service" \\

&#x20;       --region "$AWS\_REGION" >/dev/null 2>\&1 \\

&#x20;     || aws ecr create-repository \\

&#x20;       --repository-name "$service" \\

&#x20;       --region "$AWS\_REGION"

&#x20;   done



Build and push the images:



&#x20;   for service in auth-service user-service file-service admin-service; do

&#x20;     docker build \\

&#x20;       -t "$service:1.0" \\

&#x20;       "./services/$service"



&#x20;     docker tag "$service:1.0" \\

&#x20;       "$AWS\_ACCOUNT\_ID.dkr.ecr.$AWS\_REGION.amazonaws.com/$service:1.0"



&#x20;     docker push \\

&#x20;       "$AWS\_ACCOUNT\_ID.dkr.ecr.$AWS\_REGION.amazonaws.com/$service:1.0"

&#x20;   done



These commands assume your Docker builder can build images for the

architecture used by your EKS nodes. If your nodes use ARM64 or AMD64,

build for the matching architecture.



\## 7. Configure EKS



Create or select an EKS cluster and configure kubectl.



&#x20;   aws eks update-kubeconfig \\

&#x20;     --name YOUR\_CLUSTER\_NAME \\

&#x20;     --region "$AWS\_REGION"



Install and configure the AWS Load Balancer Controller or NGINX Ingress

Controller, depending on which ingress implementation you choose.



Configure IAM permissions for the application using EKS Pod Identity

or IRSA. The runtime role needs only the required Secrets Manager,

DynamoDB, and S3 permissions.



Update k8s/configmap.yaml with the actual RDS endpoint, secret ARN,

DynamoDB table name, and S3 bucket name.



Update all image references in k8s/deployments.yaml with your ECR

account ID and region.



Create a Kubernetes Secret for the database password:



&#x20;   kubectl create namespace fullstack-app



&#x20;   kubectl -n fullstack-app create secret generic app-runtime-secrets \\

&#x20;     --from-literal=DB\_PASSWORD='YOUR\_DATABASE\_PASSWORD'



Use a secret-injection solution or deployment automation to keep

Secrets Manager and Kubernetes secrets synchronized in real environments.



Apply the manifests:



&#x20;   kubectl apply -f k8s/configmap.yaml

&#x20;   kubectl apply -f k8s/deployments.yaml

&#x20;   kubectl apply -f k8s/services.yaml

&#x20;   kubectl apply -f k8s/ingress.yaml



Check status:



&#x20;   kubectl get pods -n fullstack-app

&#x20;   kubectl get services -n fullstack-app

&#x20;   kubectl get ingress -n fullstack-app



Check logs:



&#x20;   kubectl logs -n fullstack-app deployment/auth-service

&#x20;   kubectl logs -n fullstack-app deployment/user-service

&#x20;   kubectl logs -n fullstack-app deployment/file-service

&#x20;   kubectl logs -n fullstack-app deployment/admin-service



\## 8. Build the frontend for S3



From the frontend folder:



&#x20;   npm install

&#x20;   npm run build



Create a private S3 bucket for frontend hosting and configure CloudFront

with Origin Access Control (OAC). Do not make the bucket public.



Upload the build:



&#x20;   aws s3 sync dist/ s3://YOUR\_FRONTEND\_BUCKET/ --delete



Configure CloudFront so /api/\* routes to your API origin and other

requests go to the frontend S3 origin. Configure SPA error handling so

client-side routes return index.html where appropriate.



After deployment, invalidate CloudFront when necessary:



&#x20;   aws cloudfront create-invalidation \\

&#x20;     --distribution-id YOUR\_DISTRIBUTION\_ID \\

&#x20;     --paths "/\*"



\## 9. Parameter Store



Use AWS Systems Manager Parameter Store for non-secret configuration,

such as environment names and service settings. For example:



&#x20;   aws ssm put-parameter \\

&#x20;     --name /fullstack-app/dev/DB\_NAME \\

&#x20;     --type String \\

&#x20;     --value fullstackapp \\

&#x20;     --overwrite



&#x20;   aws ssm get-parameter \\

&#x20;     --name /fullstack-app/dev/DB\_NAME \\

&#x20;     --query Parameter.Value \\

&#x20;     --output text



Connect your deployment process to read approved parameters and update

the Kubernetes ConfigMap. Keep passwords and signing keys in Secrets

Manager, not in a ConfigMap.



\## Security notes



\- Use HTTPS for public traffic.

\- Restrict RDS access to the application network.

\- Keep S3 buckets private and enable encryption.

\- Use least-privilege IAM policies and EKS Pod Identity or IRSA.

\- Rotate secrets and plan how services reload rotated credentials.

\- Add rate limiting, audit logging, backups, monitoring, and tests.

\- This is a learning starter, not a production-certified application.



