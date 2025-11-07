import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { aws_apigateway as apigateway } from 'aws-cdk-lib';
import * as path from 'path';
import * as rds from 'aws-cdk-lib/aws-rds';
import { aws_secretsmanager as secretsmanager } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

export class CartStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = dotenv.parse(fs.readFileSync('.env'));
    const authUsername = env['AUTH_USERNAME'];
    const authPassword = env['AUTH_PASSWORD'];
    const dbName = 'cartDB';

    if (!authUsername || !authPassword) {
      throw new Error('Missing AUTH_USERNAME or AUTH_PASSWORD in .env');
    }

    const dbCredentialsSecret = new secretsmanager.Secret(this, 'MyDBCreds', {
      secretName: 'DBCredentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: env['AUTH_USERNAME'],
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      }
    });

    const vpc = new ec2.Vpc(this, 'MyVPC', {
      maxAzs: 2, // Default is all AZs in the region
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'CartLambdaSecurityGroup', {
      vpc,
      description: 'Security group for Cart Lambda functions',
      allowAllOutbound: true,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'CartDBSecurityGroup', {
      vpc,
      description: 'Security group for Cart RDS instance',
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Lambda'
    );

    const dbInstance = new rds.DatabaseInstance(this, 'RDSInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      // vpcSubnets: {
      //   subnetType: ec2.SubnetType.PUBLIC
      // },
      publiclyAccessible: false,
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      databaseName: dbName,
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false
    });

    const nestProjectDir = path.join(__dirname, '..', '..', 'nodejs-aws-cart-api');
    const lambdaFunction = new lambdaNodejs.NodejsFunction(this, 'LambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(nestProjectDir, 'dist', 'lambda_bundle.js'),
      handler: 'handler',
      memorySize: 254,
      timeout: cdk.Duration.seconds(10),
      projectRoot: nestProjectDir,
      depsLockFilePath: path.join(nestProjectDir, 'package-lock.json'),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_HOST: dbInstance.dbInstanceEndpointAddress,
        DB_PORT: dbInstance.dbInstanceEndpointPort,
        DB_SECRET_ARN: dbCredentialsSecret.secretArn,
        DB_NAME: dbName,
      },
      bundling: {
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        externalModules:  ['@aws-sdk/*', '@nestjs/microservices', '@nestjs/websockets', 'class-validator', 'class-transformer'],
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [`npm --prefix "${nestProjectDir}" run build`];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          beforeInstall(inputDir: string, outputDir: string): string[] {
            return [];
          }
        }
      },
    });

    dbCredentialsSecret.grantRead(lambdaFunction);

    const api = new apigateway.RestApi(this, 'NestApi', {
      restApiName: 'Nest Service',
      description: 'This service serves a Nest.js application.',
    });

    const getLambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', getLambdaIntegration);
  }
}
