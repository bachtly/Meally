# Meally's web hosting and address: a Cloudflare Pages project, its custom domain, and the CNAME at Vercel DNS.
# Supabase (database, bucket, cron, Edge Function) is managed by the CLI in scripts/deploy.sh.
# State holds no secrets: tokens come from the environment, and every value here is public.

terraform {
  required_version = ">= 1.9"

  # Connection from PG_CONN_STR and PGPASSWORD (scripts/deploy.sh builds them). Use Supabase's session pooler
  # (port 5432): state locking needs advisory locks, and the transaction pooler (6543) has none.
  backend "pg" {
    schema_name = "meally_terraform_state"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.26"
    }
  }
}

# Tokens: CLOUDFLARE_API_TOKEN and VERCEL_API_TOKEN.
provider "cloudflare" {}

provider "vercel" {
  team = var.vercel_team_id == "" ? null : var.vercel_team_id
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Pages project."
  type        = string
}

variable "vercel_team_id" {
  description = "Vercel team that owns the DNS zone. Empty for a personal account."
  type        = string
  default     = ""
}

variable "domain" {
  description = "DNS zone on Vercel DNS."
  type        = string
  default     = "bachtly.com"
}

variable "subdomain" {
  type    = string
  default = "meally"
}

variable "project_name" {
  description = "Cloudflare Pages project name (also used by wrangler pages deploy)."
  type        = string
  default     = "meally"
}

# No Git source: scripts/deploy.sh builds the app and uploads it with wrangler (Direct Upload).
resource "cloudflare_pages_project" "app" {
  account_id        = var.cloudflare_account_id
  name              = var.project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "app" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.app.name
  name         = "${var.subdomain}.${var.domain}"
}

# After the Pages domain: a CNAME that exists first gets a 522 from Cloudflare.
resource "vercel_dns_record" "app" {
  domain = var.domain
  name   = var.subdomain
  type   = "CNAME"
  value  = cloudflare_pages_project.app.subdomain
  ttl    = 60

  depends_on = [cloudflare_pages_domain.app]
}

output "pages_hostname" {
  value = cloudflare_pages_project.app.subdomain
}

output "app_url" {
  value = "https://${var.subdomain}.${var.domain}"
}
