#!/bin/bash
# ==============================================
# HalaChat - Server Setup Script
# Ubuntu 24.04 LTS
# Domain: halachat.khalafiati.io
# ==============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo -e "\n${BLUE}[STEP]${NC} $1"
    echo "=============================================="
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

DOMAIN="halachat.khalafiati.io"
APP_DIR="/var/www/HalaChat"
LOG_DIR="/var/log/halachat"

echo "=============================================="
echo "   HalaChat Server Setup"
echo "   Domain: $DOMAIN"
echo "   Directory: $APP_DIR"
echo "=============================================="
echo ""
read -p "Continue? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

# ------------------------------------------
# 1. System Update
# ------------------------------------------
print_step "1/9 - Updating system packages..."
apt update && apt upgrade -y
print_success "System updated"

# ------------------------------------------
# 2. Install Node.js 20.x
# ------------------------------------------
print_step "2/9 - Installing Node.js 20.x..."
if command -v node &> /dev/null; then
    NODE_VER=$(node -v)
    print_warning "Node.js already installed: $NODE_VER"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    print_success "Node.js installed: $(node -v)"
fi
print_success "npm version: $(npm -v)"

# ------------------------------------------
# 3. Install PM2
# ------------------------------------------
print_step "3/9 - Installing PM2..."
if command -v pm2 &> /dev/null; then
    print_warning "PM2 already installed"
else
    npm install -g pm2
    print_success "PM2 installed"
fi

# ------------------------------------------
# 4. Check MongoDB
# ------------------------------------------
print_step "4/9 - Checking MongoDB..."
if systemctl is-active --quiet mongod 2>/dev/null || systemctl is-active --quiet mongodb 2>/dev/null; then
    print_success "MongoDB is running"
elif command -v mongod &> /dev/null; then
    print_warning "MongoDB installed but not running. Starting..."
    systemctl start mongod 2>/dev/null || systemctl start mongodb 2>/dev/null
    print_success "MongoDB started"
else
    print_warning "MongoDB not found. Installing..."
    # MongoDB 7.0 for Ubuntu 24.04
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list
    apt update
    apt install -y mongodb-org
    systemctl start mongod
    systemctl enable mongod
    print_success "MongoDB installed and started"
fi

# ------------------------------------------
# 5. Check Nginx
# ------------------------------------------
print_step "5/9 - Checking Nginx..."
if command -v nginx &> /dev/null; then
    print_success "Nginx already installed"
else
    apt install -y nginx
    systemctl enable nginx
    print_success "Nginx installed"
fi

# ------------------------------------------
# 6. Create directories
# ------------------------------------------
print_step "6/9 - Creating directories..."
mkdir -p $APP_DIR
mkdir -p $LOG_DIR
mkdir -p $APP_DIR/backend/uploads
print_success "Directories created"

# ------------------------------------------
# 7. Copy Nginx config
# ------------------------------------------
print_step "7/9 - Configuring Nginx..."
if [ -f "$APP_DIR/deploy/nginx-halachat.conf" ]; then
    cp $APP_DIR/deploy/nginx-halachat.conf /etc/nginx/sites-available/halachat
    ln -sf /etc/nginx/sites-available/halachat /etc/nginx/sites-enabled/halachat

    # Test nginx config
    nginx -t
    systemctl reload nginx
    print_success "Nginx configured and reloaded"
else
    print_warning "Nginx config not found. Will configure after file upload."
fi

# ------------------------------------------
# 8. Setup SSL with Certbot
# ------------------------------------------
print_step "8/9 - Setting up SSL (Let's Encrypt)..."
if command -v certbot &> /dev/null; then
    print_warning "Certbot already installed"
else
    apt install -y certbot python3-certbot-nginx
    print_success "Certbot installed"
fi

echo ""
echo -e "${YELLOW}NOTE: SSL will be configured after DNS is pointed to this server.${NC}"
echo -e "${YELLOW}Run this command when DNS is ready:${NC}"
echo -e "${GREEN}  certbot --nginx -d $DOMAIN${NC}"
echo ""

# ------------------------------------------
# 9. Setup Firewall
# ------------------------------------------
print_step "9/9 - Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 'Nginx Full' 2>/dev/null || true
    ufw allow OpenSSH 2>/dev/null || true
    print_success "Firewall rules added"
else
    print_warning "UFW not found, skipping firewall setup"
fi

# ------------------------------------------
# Summary
# ------------------------------------------
echo ""
echo "=============================================="
echo -e "${GREEN}   Server Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  1. Upload project files to $APP_DIR"
echo "  2. Run: cd $APP_DIR && bash deploy/deploy.sh"
echo "  3. Point DNS A record for $DOMAIN to this server IP"
echo "  4. Run: certbot --nginx -d $DOMAIN"
echo ""
echo "=============================================="
