# DISCORD SUPPORT TICKET BOT
A support ticket bot for discord

## PREREQUISITES
- AWS Account
- Discord Developer Account (to create the bot and get tokens)
- PuTTY

### LAUNCH AN EC2 INSTANCE

#### CREATE AN EC2 INSTANCE
- Login to your AWS Console
- Go to EC2 Dashboard
- Launch Amazon Linux 2 instance
- Make sure to create or select a key pair to connect to your instance

#### ADJUST SECURITY GROUP SETTINGS
- Allow SSH (port 22) for your IP address
- Allow outbound traffic (the bot only needs outbound internet access)

### CONVERT .PEM TO .PPK FOR PUTTY
- Download PuTTYgen from the PuTTY website if you don't have it (https://www.putty.org/)
- Open PuTTYgen
- Click "Load" and select your .pem file
- Click "Save Private Key" to create a .ppk file

### CONNECT TO THE INSTANCE WITH PUTTY

#### OPEN PUTTY
- Enter your EC2 public DNS or IP in the "Host Name" field
- Default port: 22
- CONFIGURE SSH AUTH
- In the left panel, go to Connection > SSH > Auth > Credentials
- Browse and select your .ppk file
- In Connection > Data, set "Auto-login username" to "ec2-user"
- Click "Open" to start the SSH session

#### CONFIGURE SSH AUTH
- In the left panel, go to Connection > SSH > Auth > Credentials
- Browse and select your .ppk file
- In Connection > Data, set "Auto-login username" to "ec2-user"
- Click "Open" to start the SSH session

### SET UP ENVIROMENT ON EC2

```sudo yum update -y

# Create project directory
mkdir -p ~/support-ticket-bot
cd ~/support-ticket-bot

# Create directory for logs/transcripts
mkdir -p logs transcripts```

### CREATE AND EDIT FILES WITH NANO ###

#### CREATE INDEX.JS
```nano index.js```
- Paste the complete index.js code
- To paste in PuTTY: Right-click in the terminal window (or press Shift+Insert)
- Save and exit with: Ctrl+X, then Y, then Enter

#### CREATE PACKAGE.JSON FILE
```nano package.json```
- Paste the complete package.json code
- Save and exit: Ctrl+X, Y, Enter

#### CREATE .ENV FILE
```nano .env```
- Paste .env contents with tokens, logins, etc. added
- Save and exit: Ctrl+X, Y, Enter

### INSTALL DEPENDENCIES
```sudo yum update -y

curl -sL https://rpm.nodesource.com/setup_16.x | sudo bash -
sudo yum install -y nodejs
npm install

# Install PM2 globally
sudo npm install -g pm2
```

### VERIFY INSTALLATION
```node --version
npm --version```

### START THE BOT
```pm2 start index.js --name "ticket-bot" --time --log-date-format="YYYY-MM-DD HH:mm:ss" --max-memory-restart=300M

# Configure PM2 to start on reboot
pm2 startup
# Run the command it outputs
pm2 save

# View logs
pm2 logs ticket-bot```

### VERIFY BOT IS WORKING
- Check bot is online in your Discord server
- Test /verify command
- Monitor logs: ```pm2 logs ticket-bot```
