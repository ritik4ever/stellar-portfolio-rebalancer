resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    cidr_blocks     = ["10.0.0.0/16"] # Allow access from VPC
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-rds-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.name_prefix}-rds-subnet-group"
  }
}

resource "aws_db_instance" "main" {
  identifier                  = "${var.name_prefix}-db"
  engine                      = "postgres"
  engine_version              = "15.4"
  instance_class              = var.instance_class
  allocated_storage           = 20
  storage_type                = "gp3"
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.rds.id]
  db_name                     = "stellar_portfolio"
  username                    = "dbadmin"
  manage_master_user_password = true # Stores password in Secrets Manager automatically
  skip_final_snapshot         = true
  publicly_accessible         = false

  tags = {
    Name = "${var.name_prefix}-db"
  }
}
