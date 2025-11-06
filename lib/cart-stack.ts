import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { aws_apigateway as apigateway } from 'aws-cdk-lib';
import * as path from 'path';

export class CartStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const nestProjectDir = path.join(__dirname, '..', '..', 'nodejs-aws-cart-api');
    const lambdaFunction = new lambdaNodejs.NodejsFunction(this, 'LambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(nestProjectDir, 'dist', 'lambda_bundle.js'),
      handler: 'handler',
      memorySize: 254,
      timeout: cdk.Duration.seconds(10),
      projectRoot: nestProjectDir,
      depsLockFilePath: path.join(nestProjectDir, 'package-lock.json'),
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

    const api = new apigateway.RestApi(this, 'NestApi', {
      restApiName: 'Nest Service',
      description: 'This service serves a Nest.js application.',
    });

    const getLambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', getLambdaIntegration);
  }
}
