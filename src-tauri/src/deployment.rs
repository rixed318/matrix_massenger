use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentConfig {
    pub server_ip: String,
    pub ssh_user: String,
    pub ssh_password: String,
    pub domain: Option<String>,
    pub admin_username: String,
    pub admin_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentStatus {
    pub step: String,
    pub progress: u8,
    pub message: String,
    pub success: bool,
}

pub fn create_synapse_install_script(config: &DeploymentConfig) -> String {
    let domain = config.domain.as_ref().unwrap_or(&config.server_ip);
    let admin_user = &config.admin_username;
    let admin_pass = &config.admin_password;

    // Build script with proper variable substitution
    let script = format!(
        r#"#!/bin/bash
set -e

echo "=== Matrix Synapse Auto-Installer ==="
echo "Server: {}"

# Update system
echo "[1/8] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install dependencies
echo "[2/8] Installing dependencies..."
sudo apt install -y wget apt-transport-https gnupg lsb-release nginx certbot python3-certbot-nginx curl

# Add Matrix repository
echo "[3/8] Adding Matrix repository..."
sudo wget -O /usr/share/keyrings/matrix-org-archive-keyring.gpg https://packages.matrix.org/debian/matrix-org-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/matrix-org-archive-keyring.gpg] https://packages.matrix.org/debian/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/matrix-org.list

# Install Synapse
echo "[4/8] Installing Matrix Synapse..."
sudo apt update
echo "matrix-synapse matrix-synapse/server-name string {}" | sudo debconf-set-selections
echo "matrix-synapse matrix-synapse/report-stats boolean false" | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt install -y matrix-synapse-py3

# Configure Synapse
echo "[5/8] Configuring Synapse..."
sudo tee /etc/matrix-synapse/homeserver.yaml > /dev/null <<EOF
server_name: "{}"
pid_file: /var/run/matrix-synapse.pid
web_client: false
soft_file_limit: 0
log_config: "/etc/matrix-synapse/log.yaml"

listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    bind_addresses: ['0.0.0.0']
    resources:
      - names: [client, federation]
        compress: false

database:
  name: sqlite3
  args:
    database: /var/lib/matrix-synapse/homeserver.db

enable_registration: true
enable_registration_without_verification: true
allow_public_rooms_over_federation: true
allow_public_rooms_without_auth: false

media_store_path: /var/lib/matrix-synapse/media
max_upload_size: 50M
EOF

# Configure Nginx
echo "[6/8] Configuring Nginx..."
sudo tee /etc/nginx/sites-available/matrix > /dev/null <<'NGINX'
server {{
    listen 80;
    listen [::]:80;
    server_name {};

    location /.well-known/matrix/ {{
        proxy_pass http://localhost:8008/.well-known/matrix/;
        proxy_set_header X-Forwarded-For $remote_addr;
    }}

    location /_matrix {{
        proxy_pass http://localhost:8008;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        client_max_body_size 50M;
    }}
}}
NGINX

sudo ln -sf /etc/nginx/sites-available/matrix /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Start Synapse
echo "[7/8] Starting Matrix Synapse..."
sudo systemctl enable matrix-synapse
sudo systemctl restart matrix-synapse

# Wait for service to start
sleep 5

# Create admin user
echo "[8/8] Creating admin user..."
register_new_matrix_user -c /etc/matrix-synapse/homeserver.yaml -u {} -p {} -a http://localhost:8008

# Configure firewall
echo "Configuring firewall..."
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8008/tcp
sudo ufw --force enable

# Verify installation
echo "Verifying installation..."
curl -s http://localhost:8008/_matrix/client/versions | grep -q "versions" && echo "✓ Synapse is running!" || echo "✗ Verification failed"

echo ""
echo "=== Installation Complete! ==="
echo "Homeserver URL: http://{}:8008"
echo "or https://{} (if SSL configured)"
echo "Admin user: {}"
echo ""
echo "Next steps:"
echo "1. Configure SSL certificate (optional): sudo certbot --nginx -d {}"
echo "2. Connect from your Matrix client"
"#,
        domain, domain, domain, domain, domain, domain, admin_user, admin_pass, domain, domain, admin_user, domain
    );

    script
}

pub fn execute_remote_command(
    config: &DeploymentConfig,
    command: &str,
) -> Result<String, String> {
    // Clean IP address (remove protocol if present)
    let clean_ip = config.server_ip
        .trim()
        .replace("https://", "")
        .replace("http://", "")
        .split(':')
        .next()
        .unwrap_or(&config.server_ip)
        .trim()
        .to_string();

    // Connect to SSH
    let tcp = TcpStream::connect(format!("{}:22", clean_ip))
        .map_err(|e| format!("Failed to connect to {}:22 - {}", clean_ip, e))?;

    let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    sess.userauth_password(&config.ssh_user, &config.ssh_password)
        .map_err(|e| format!("SSH authentication failed: {}", e))?;

    // Execute command
    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

    channel
        .exec(command)
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    // Read output
    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| format!("Failed to read output: {}", e))?;

    channel.wait_close().ok();

    Ok(output)
}

pub fn deploy_synapse_server(config: DeploymentConfig) -> Result<Vec<DeploymentStatus>, String> {
    let mut statuses = Vec::new();

    println!("=== Starting Matrix Synapse Deployment ===");
    println!("Target server: {}", config.server_ip);

    // Step 1: Test connection
    statuses.push(DeploymentStatus {
        step: "connection".to_string(),
        progress: 10,
        message: "Testing SSH connection...".to_string(),
        success: false,
    });

    println!("Testing SSH connection to {}...", config.server_ip);
    let test_result = execute_remote_command(&config, "echo 'Connection OK' && whoami");
    if let Err(e) = test_result {
        println!("❌ Connection failed: {}", e);
        statuses.push(DeploymentStatus {
            step: "connection".to_string(),
            progress: 10,
            message: format!("Connection failed: {}", e),
            success: false,
        });
        return Err(e);
    }

    println!("✓ SSH connection established");
    println!("Connected as: {}", test_result.as_ref().unwrap());
    statuses.push(DeploymentStatus {
        step: "connection".to_string(),
        progress: 10,
        message: "SSH connection established".to_string(),
        success: true,
    });

    // Step 2: Upload installation script
    statuses.push(DeploymentStatus {
        step: "upload_script".to_string(),
        progress: 20,
        message: "Uploading installation script...".to_string(),
        success: false,
    });

    println!("Generating installation script...");
    let script = create_synapse_install_script(&config);
    let script_path = "/tmp/install_synapse.sh";

    println!("Uploading script to server ({} bytes)...", script.len());
    let upload_cmd = format!("cat > {} << 'EOFSCRIPT'\n{}\nEOFSCRIPT\nchmod +x {}",
                            script_path, script, script_path);

    execute_remote_command(&config, &upload_cmd)
        .map_err(|e| {
            println!("❌ Failed to upload script: {}", e);
            format!("Failed to upload script: {}", e)
        })?;

    println!("✓ Installation script uploaded to {}", script_path);
    statuses.push(DeploymentStatus {
        step: "upload_script".to_string(),
        progress: 20,
        message: "Installation script uploaded".to_string(),
        success: true,
    });

    // Step 3: Execute installation
    statuses.push(DeploymentStatus {
        step: "install".to_string(),
        progress: 30,
        message: "Running installation (this may take 5-10 minutes)...".to_string(),
        success: false,
    });

    println!("Starting installation process (this will take 5-10 minutes)...");
    println!("Installing Matrix Synapse, Nginx, and configuring services...");

    let install_output = execute_remote_command(&config, &format!("sudo bash {}", script_path))
        .map_err(|e| {
            println!("❌ Installation failed: {}", e);
            format!("Installation failed: {}", e)
        })?;

    println!("Installation output (last 500 chars):");
    let output_len = install_output.len();
    if output_len > 500 {
        println!("...{}", &install_output[output_len-500..]);
    } else {
        println!("{}", install_output);
    }

    println!("✓ Installation completed successfully");
    statuses.push(DeploymentStatus {
        step: "install".to_string(),
        progress: 90,
        message: "Installation completed".to_string(),
        success: true,
    });

    // Step 4: Verify
    statuses.push(DeploymentStatus {
        step: "verify".to_string(),
        progress: 95,
        message: "Verifying installation...".to_string(),
        success: false,
    });

    println!("Verifying Matrix Synapse installation...");
    let verify_result = execute_remote_command(
        &config,
        "curl -s http://localhost:8008/_matrix/client/versions",
    );

    match verify_result {
        Ok(output) if output.contains("versions") => {
            println!("✓ Verification successful!");
            println!("Server response: {}", output);
            let server_url = config.domain.as_ref().unwrap_or(&config.server_ip);
            println!("=== Deployment Complete! ===");
            println!("Homeserver URL: http://{}:8008", server_url);
            println!("Admin user: @{}:{}", config.admin_username, server_url);

            statuses.push(DeploymentStatus {
                step: "verify".to_string(),
                progress: 100,
                message: format!(
                    "Synapse server successfully deployed at http://{}:8008",
                    server_url
                ),
                success: true,
            });
        }
        _ => {
            println!("⚠️ Verification failed, but installation may have succeeded");
            statuses.push(DeploymentStatus {
                step: "verify".to_string(),
                progress: 100,
                message: "Installation completed but verification failed. Check server manually."
                    .to_string(),
                success: false,
            });
        }
    }

    Ok(statuses)
}
