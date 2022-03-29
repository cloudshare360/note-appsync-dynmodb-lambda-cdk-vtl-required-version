import * as cdk from '@aws-cdk/core';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import { Construct, RemovalPolicy } from '@aws-cdk/core';
import { BillingMode } from '@aws-cdk/aws-dynamodb';
import * as lambda from "@aws-cdk/aws-lambda";
import * as appsync from "@aws-cdk/aws-appsync";
import {
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
  ManagedPolicy,
} from "@aws-cdk/aws-iam";
import { LambdaDataSource, DynamoDbDataSource } from "@aws-cdk/aws-appsync";
export class NoteServiceNextGenerationSpecificVersionStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // creating appsync api.

    const apiName = `dev-appsync-api`;
    const api = new appsync.GraphqlApi(this, "Api", {
      name: apiName,
      schema: appsync.Schema.fromAsset("graphql/schema.graphql"),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365))

          },
        },
      },
      xrayEnabled: true,
    });
    const appsyncRole = new Role(this, `dev-appsync-api-role`, {
      assumedBy: new ServicePrincipal("appsync.amazonaws.com"),
    });

    //this.appHelper.grantLogsAccess(appsyncRole);

    const dynamodbAccess = new Policy(this, `dev-appsync-api-dynamodb-policy`, {
      policyName: "appSyncDynamodbAccessPolicy",
      statements: [
        new PolicyStatement({
          actions: ["dynamodb:*"],
          resources: ["arn:aws:dynamodb:*"],
        }),
      ],
    });

    dynamodbAccess.node.addDependency(appsyncRole);
    appsyncRole.attachInlinePolicy(dynamodbAccess);
    /*
    appsyncRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess")
    );
    */

    const apiRole = new cdk.CfnOutput(this, `${apiName}-apiRole`, {
      value: appsyncRole.roleArn,
      description: "appsync api role",
      exportName: `${apiName}-role`,
    });

    //  ======= configuring lambda datasource, custom authorizer for authenticating requests =======
    const customAuthFn = lambda.Function.fromFunctionAttributes(
        this,
        "custom-authorizer-lmda",
        {
          functionArn:  "arn:aws:lambda:us-east-1:376398814030:function: ta-e2eops-dev-cb-custom-authorizer",
          sameEnvironment: true

        }

    );

    const customAuthDataSrc = new LambdaDataSource(
        this,
        "customAuthDataSrc",
        {
          api: api,
          lambdaFunction: customAuthFn,
          description: 'custom authorizer datasource',
          name: "customAuthDataSrc",
          serviceRole: appsyncRole
        }
    );

    const authFn = new appsync.AppsyncFunction(this, 'authFn', {
      api,
      name: 'customAuth',
      dataSource: customAuthDataSrc,
      requestMappingTemplate: appsync.MappingTemplate.fromFile("mapping-templates/customAuthorizer_Req.vtl"),
      responseMappingTemplate: appsync.MappingTemplate.fromFile("mapping-templates/customAuthorizer_Res.vtl")
    });



    // ======= configuring dynamodb datasource, resolver for start of query:getRegInfoByRegNo =======

    const RegDataTbl = dynamodb.Table.fromTableName(
        this,
        "reg-tbl",
        "dev-reg-data"
    );

    const RegDataSrc = new DynamoDbDataSource(
        this,
        "RegDataSrc",
        {
          api: api,
          table: RegDataTbl,
          description: '  reg as datasource',
          name: "RegDataSrc",
          serviceRole: appsyncRole
        }
    );

    const RegDataFunc = new appsync.AppsyncFunction(this, 'RegDataFunc', {
      api,
      name: 'RegDataFunc',
      dataSource: RegDataSrc,
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
          "mapping-templates/getRegInfoByRegNo_Req.vtl"
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
          "mapping-templates/getRegInfoByRegNo_Res.vtl"
      )
    });

    // const RegDataResolver = new appsync.Resolver(this, 'RegDataPipeline', {
    //   api,
    //   typeName: 'Query',
    //   fieldName: 'getRegInfoByRegNo',
    //   pipelineConfig: [authFn, RegDataFunc],
    //   requestMappingTemplate: appsync.MappingTemplate.fromFile("mapping-templates/dynamodb_before_mapping_temp.vtl"),
    //   responseMappingTemplate: appsync.MappingTemplate.fromFile("mapping-templates/dynamodb_after_mapping_temp.vtl")
    // });


    //============================== create table dev-reg====================================
    const envTable = "dev-reg"
    const table = new dynamodb.Table(this, envTable, {
      tableName: envTable,
      partitionKey: {
        name: 'AdminGuid',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'regId',
        type: dynamodb.AttributeType.STRING
      },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL'
    });

    table.addGlobalSecondaryIndex({
      indexName: envTable + "-gsi",
      sortKey: {
        name: 'asmtEventId',
        type: dynamodb.AttributeType.NUMBER
      },
      partitionKey: {
        name: 'regId',
        type: dynamodb.AttributeType.STRING
      }
    });

    table.addGlobalSecondaryIndex({
      indexName: envTable + "-personId-gsi",
      partitionKey: {
        name: 'personId',
        type: dynamodb.AttributeType.STRING
      }
    });

    table.addGlobalSecondaryIndex({
      indexName: envTable + "-asmtEventId-gsi",
      partitionKey: {
        name: 'asmtEventId',
        type: dynamodb.AttributeType.NUMBER
      }
    });

    table.addGlobalSecondaryIndex({
      indexName: envTable + "-regNo-gsi",
      partitionKey: {
        name: 'regNo',
        type: dynamodb.AttributeType.STRING
      }
    });



    // The code that defines your stack goes here
  }
}
