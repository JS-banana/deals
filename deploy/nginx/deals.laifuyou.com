# /etc/nginx/sites-available/deals.laifuyou.com — certbot adds the TLS server block on first issue.
limit_req_zone $binary_remote_addr zone=deals_community:10m rate=10r/m;

server {
    server_name deals.laifuyou.com;
    listen 80;

    location ~ ^/api/(votes|tips)$ {
        limit_req zone=deals_community burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    include /etc/nginx/snippets/security-headers.conf;
}
