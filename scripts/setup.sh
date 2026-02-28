#!/bin/bash

# Check if running on a supported system
case "$(uname -s)" in
  Linux)
    if [[ -f "/etc/lsb-release" ]]; then
      . /etc/lsb-release
      if [[ "$DISTRIB_ID" != "Ubuntu" ]]; then
        echo "This script only works on Ubuntu, not $DISTRIB_ID."
        exit 1
      fi
    else
      if [[ !"$(cat /etc/*-release | grep '^ID=')" =~ ^(ID=\"ubuntu\")|(ID=\"centos\")|(ID=\"arch\")|(ID=\"debian\")$ ]]; then
        echo "Unsupported Linux distribution."
        exit 1
      fi
    fi
    ;;
  Darwin)
    echo "Running on MacOS."
    ;;
  *)
    echo "Unsupported operating system."
    exit 1
    ;;
esac

# Check if needed dependencies are installed and install if necessary
if ! command -v node >/dev/null || ! command -v git >/dev/null || ! command -v npm >/dev/null; then
  case "$(uname -s)" in
    Linux)
      if [[ "$(cat /etc/*-release | grep '^ID=')" = "ID=ubuntu" ]]; then
        sudo apt-get update
        sudo apt-get -y install nodejs git
      elif [[ "$(cat /etc/*-release | grep '^ID=')" = "ID=debian" ]]; then
        sudo apt-get update
        sudo apt-get -y install nodejs git
      elif [[ "$(cat /etc/*-release | grep '^ID=')" = "ID=centos" ]]; then
        sudo yum -y install epel-release
        sudo yum -y install nodejs git
      elif [[ "$(cat /etc/*-release | grep '^ID=')" = "ID=arch" ]]; then
        sudo pacman -Syu -y
        sudo pacman -S -y nodejs git
      else
        echo "Unsupported Linux distribution"
        exit 1
      fi
      ;;
    Darwin)
      /usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
      brew install node git
      ;;
  esac
fi

# Clone the repository and install dependencies
git clone https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web
cd ChatGPT-Next-Web
npm install

# Prompt user for environment variables
read -p "Enter ROUTER_BACKEND_URL [http://127.0.0.1:3011]: " ROUTER_BACKEND_URL
read -p "Enter WEBDAV_BACKEND_BASE_URL [http://127.0.0.1:6065]: " WEBDAV_BACKEND_BASE_URL
read -p "Enter WEBDAV_BACKEND_PREFIX [/dav]: " WEBDAV_BACKEND_PREFIX
read -p "Enter PORT [3020]: " PORT

ROUTER_BACKEND_URL=${ROUTER_BACKEND_URL:-http://127.0.0.1:3011}
WEBDAV_BACKEND_BASE_URL=${WEBDAV_BACKEND_BASE_URL:-http://127.0.0.1:6065}
WEBDAV_BACKEND_PREFIX=${WEBDAV_BACKEND_PREFIX:-/dav}
PORT=${PORT:-3020}

cat > .env <<EOF
ROUTER_BACKEND_URL=${ROUTER_BACKEND_URL}
WEBDAV_BACKEND_BASE_URL=${WEBDAV_BACKEND_BASE_URL}
WEBDAV_BACKEND_PREFIX=${WEBDAV_BACKEND_PREFIX}
EOF

# Build and run the project
npm run build
PORT=$PORT npm run start
