-- Generated from schema.dbml. No schema changes are performed by opening the database.
CREATE TYPE "AuthorityType" AS ENUM ('Person','Organization','Other');
CREATE TYPE "DatePrecision" AS ENUM ('year_only','year_month','exact');
CREATE TYPE "BookCopyCondition" AS ENUM ('normal','lost','damaged','stolen','unknown');
CREATE TYPE "BookCopyLoanPolicy" AS ENUM ('available','suspended','no_loan','in_library_only','no_access');
CREATE TYPE "ChangeOperation" AS ENUM ('create','update','delete');
CREATE TABLE users (id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(), auth_issuer TEXT NOT NULL, auth_subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), display_name_cache TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(auth_issuer,auth_subject));
CREATE TABLE roles (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE user_roles (user_id UUID NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id,role_id));
CREATE TABLE "AuthorAuthority" (
 "Id" VARCHAR(26) NOT NULL PRIMARY KEY, "Type" "AuthorityType" NOT NULL,
 "TitleLanguage" TEXT, "Title" TEXT NOT NULL, "TitleTranscription" TEXT,
 "TitleAlternative" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("TitleAlternative") = 'array'),
 "BirthDate" VARCHAR(10), "BirthDatePrecision" "DatePrecision",
 "FoundationDate" VARCHAR(10), "FoundationDatePrecision" "DatePrecision", "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("BirthDate" IS NULL) = ("BirthDatePrecision" IS NULL)), CHECK (("FoundationDate" IS NULL) = ("FoundationDatePrecision" IS NULL)),
 CHECK ("Type" <> 'Organization' OR "BirthDate" IS NULL), CHECK ("Type" <> 'Person' OR "FoundationDate" IS NULL)
);
CREATE TABLE "AuthorAuthorityReference" ("AuthorAuthorityId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "AuthorAuthority"("Id"),
 "Reference" JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof("Reference") = 'object'), "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "PublisherAuthority" (
 "Id" VARCHAR(26) NOT NULL PRIMARY KEY, "Type" "AuthorityType" NOT NULL,
 "TitleLanguage" TEXT, "Title" TEXT NOT NULL, "TitleTranscription" TEXT,
 "TitleAlternative" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("TitleAlternative") = 'array'),
 "BirthDate" VARCHAR(10), "BirthDatePrecision" "DatePrecision",
 "FoundationDate" VARCHAR(10), "FoundationDatePrecision" "DatePrecision", "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("BirthDate" IS NULL) = ("BirthDatePrecision" IS NULL)), CHECK (("FoundationDate" IS NULL) = ("FoundationDatePrecision" IS NULL)),
 CHECK ("Type" <> 'Organization' OR "BirthDate" IS NULL), CHECK ("Type" <> 'Person' OR "FoundationDate" IS NULL)
);
CREATE TABLE "PublisherAuthorityReference" ("PublisherAuthorityId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "PublisherAuthority"("Id"),
 "Reference" JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof("Reference") = 'object'), "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Book" (
 "Id" VARCHAR(26) NOT NULL PRIMARY KEY, "Title" TEXT NOT NULL, "TitleTranscription" TEXT,
 "AuthorSummary" TEXT, "AuthorSummaryTranscription" TEXT,
 "PublisherId" VARCHAR(26) REFERENCES "PublisherAuthority"("Id"), "PublisherSummary" TEXT, "PublisherSummaryTranscription" TEXT,
 "FirstPublishDate" VARCHAR(10), "FirstPublishDatePrecision" "DatePrecision",
 "NDC" VARCHAR(100), "NDCEdition" VARCHAR(20), "Language" TEXT, "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "CreatedBy" UUID REFERENCES users(id), "UpdatedBy" UUID REFERENCES users(id), "Version" INTEGER NOT NULL DEFAULT 1 CHECK ("Version">0),
 CHECK (("FirstPublishDate" IS NULL) = ("FirstPublishDatePrecision" IS NULL))
);
CREATE INDEX book_publisher ON "Book"("PublisherId");
CREATE TABLE "BookAuthor" ("BookId" VARCHAR(26) NOT NULL REFERENCES "Book"("Id"), "AuthorId" VARCHAR(26) NOT NULL REFERENCES "AuthorAuthority"("Id"),
 "Position" INTEGER NOT NULL CHECK ("Position">0), "Role" TEXT, PRIMARY KEY("BookId","Position"));
CREATE INDEX book_author ON "BookAuthor"("AuthorId");
CREATE TABLE "BookReference" ("BookId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "Book"("Id"), "Reference" JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof("Reference") = 'object'), "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "BookOtherAttribute" ("BookId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "Book"("Id"), "Attribute" JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof("Attribute") = 'object'), "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Copy" ("Id" VARCHAR(26) NOT NULL PRIMARY KEY, "BookId" VARCHAR(26) NOT NULL REFERENCES "Book"("Id"),
 "ManagementCode" TEXT NOT NULL UNIQUE CHECK (length(trim("ManagementCode"))>0), "DeliveredAt" TIMESTAMPTZ,
 "Condition" "BookCopyCondition" NOT NULL DEFAULT 'normal', "LoanPolicy" "BookCopyLoanPolicy" NOT NULL DEFAULT 'available', "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "CreatedBy" UUID REFERENCES users(id), "UpdatedBy" UUID REFERENCES users(id), "Version" INTEGER NOT NULL DEFAULT 1 CHECK ("Version">0));
CREATE INDEX copy_book ON "Copy"("BookId");
CREATE TABLE "ChangeBatch" ("Id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(), "ActorUserId" UUID REFERENCES users(id), "ActorDisplayName" TEXT, "Source" TEXT, "Reason" TEXT,
 "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX change_batch_actor ON "ChangeBatch"("ActorUserId");
CREATE INDEX change_batch_created ON "ChangeBatch"("CreatedAt");
CREATE TABLE "ChangeHistory" ("Id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(), "BatchId" UUID NOT NULL REFERENCES "ChangeBatch"("Id"),
 "EntityType" TEXT NOT NULL, "EntityId" TEXT NOT NULL, "Operation" "ChangeOperation" NOT NULL,
 "SnapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("SnapshotSchemaVersion">0), "EntityVersion" INTEGER,
 "BeforeData" JSONB, "AfterData" JSONB, "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("Operation"='create' AND "BeforeData" IS NULL AND "AfterData" IS NOT NULL) OR ("Operation"='update' AND "BeforeData" IS NOT NULL AND "AfterData" IS NOT NULL) OR ("Operation"='delete' AND "BeforeData" IS NOT NULL AND "AfterData" IS NULL)),
 CHECK ("BeforeData" IS NULL OR (jsonb_typeof("BeforeData") = 'object')), CHECK ("AfterData" IS NULL OR (jsonb_typeof("AfterData") = 'object')));
CREATE INDEX change_history_batch ON "ChangeHistory"("BatchId");
CREATE INDEX change_history_entity ON "ChangeHistory"("EntityType","EntityId","CreatedAt");
