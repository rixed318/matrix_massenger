export interface DeploymentConfig {
    server_ip: string;
    ssh_user: string;
    ssh_password: string;
    domain?: string;
    admin_username: string;
    admin_password: string;
}

export interface DeploymentStatus {
    step: string;
    progress: number;
    message: string;
    success: boolean;
}
