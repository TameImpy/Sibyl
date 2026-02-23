#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ContentTaggingStack } from './stacks/content-tagging-stack';

const app = new cdk.App();

// Get environment from context or use dev as default
const environment = app.node.tryGetContext('environment') || 'dev';
const region = app.node.tryGetContext('region') || 'us-east-1';

// Stack naming convention: project-env-component
new ContentTaggingStack(app, `SibylTagging-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  description: 'Intelligent Content Tagging System - PoC Infrastructure',
  tags: {
    Project: 'Sibyl',
    Component: 'ContentTagging',
    Environment: environment,
    ManagedBy: 'CDK',
    CostCenter: 'AI-Tagging',
  },
  stackName: `sibyl-tagging-${environment}`,
});

app.synth();
