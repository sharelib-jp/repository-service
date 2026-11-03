-- Generated from schema.dbml. No schema changes are performed by opening the database.
CREATE TABLE users (id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))), auth_issuer TEXT NOT NULL, auth_subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), display_name_cache TEXT,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(auth_issuer,auth_subject));
CREATE TABLE roles (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE user_roles (user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id,role_id));
CREATE TABLE "AuthorAuthority" (
 "Id" VARCHAR(26) NOT NULL PRIMARY KEY, "Type" TEXT CHECK ("Type" IN ('Person','Organization','Other')) NOT NULL,
 "TitleLanguage" TEXT, "Title" TEXT NOT NULL, "TitleTranscription" TEXT,
 "TitleAlternative" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("TitleAlternative") AND json_type("TitleAlternative") = 'array'),
 "BirthDate" VARCHAR(10), "BirthDatePrecision" TEXT CHECK ("BirthDatePrecision" IN ('year_only','year_month','exact')),
 "FoundationDate" VARCHAR(10), "FoundationDatePrecision" TEXT CHECK ("FoundationDatePrecision" IN ('year_only','year_month','exact')), "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("BirthDate" IS NULL) = ("BirthDatePrecision" IS NULL)), CHECK (("FoundationDate" IS NULL) = ("FoundationDatePrecision" IS NULL)),
 CHECK ("Type" <> 'Organization' OR "BirthDate" IS NULL), CHECK ("Type" <> 'Person' OR "FoundationDate" IS NULL)
);
CREATE TABLE "AuthorAuthorityReference" ("AuthorAuthorityId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "AuthorAuthority"("Id"),
 "Reference" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("Reference") AND json_type("Reference") = 'object'), "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "PublisherAuthority" (
 "Id" VARCHAR(26) NOT NULL PRIMARY KEY, "Type" TEXT CHECK ("Type" IN ('Person','Organization','Other')) NOT NULL,
 "TitleLanguage" TEXT, "Title" TEXT NOT NULL, "TitleTranscription" TEXT,
 "TitleAlternative" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("TitleAlternative") AND json_type("TitleAlternative") = 'array'),
 "BirthDate" VARCHAR(10), "BirthDatePrecision" TEXT CHECK ("BirthDatePrecision" IN ('year_only','year_month','exact')),
 "FoundationDate" VARCHAR(10), "FoundationDatePrecision" TEXT CHECK ("FoundationDatePrecision" IN ('year_only','year_month','exact')), "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("BirthDate" IS NULL) = ("BirthDatePrecision" IS NULL)), CHECK (("FoundationDate" IS NULL) = ("FoundationDatePrecision" IS NULL)),
 CHECK ("Type" <> 'Organization' OR "BirthDate" IS NULL), CHECK ("Type" <> 'Person' OR "FoundationDate" IS NULL)
);
CREATE TABLE "PublisherAuthorityReference" ("PublisherAuthorityId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "PublisherAuthority"("Id"),
 "Reference" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("Reference") AND json_type("Reference") = 'object'), "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Book" (
 "Id" VARCHAR(26) NOT NULL PRIMARY KEY, "Title" TEXT NOT NULL, "TitleTranscription" TEXT,
 "AuthorSummary" TEXT, "AuthorSummaryTranscription" TEXT,
 "PublisherId" VARCHAR(26) REFERENCES "PublisherAuthority"("Id"), "PublisherSummary" TEXT, "PublisherSummaryTranscription" TEXT,
 "FirstPublishDate" VARCHAR(10), "FirstPublishDatePrecision" TEXT CHECK ("FirstPublishDatePrecision" IN ('year_only','year_month','exact')),
 "NDC" VARCHAR(100), "NDCEdition" VARCHAR(20), "Language" TEXT, "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "CreatedBy" TEXT REFERENCES users(id), "UpdatedBy" TEXT REFERENCES users(id), "Version" INTEGER NOT NULL DEFAULT 1 CHECK ("Version">0),
 CHECK (("FirstPublishDate" IS NULL) = ("FirstPublishDatePrecision" IS NULL))
);
CREATE INDEX book_publisher ON "Book"("PublisherId");
CREATE TABLE "BookAuthor" ("BookId" VARCHAR(26) NOT NULL REFERENCES "Book"("Id"), "AuthorId" VARCHAR(26) NOT NULL REFERENCES "AuthorAuthority"("Id"),
 "Position" INTEGER NOT NULL CHECK ("Position">0), "Role" TEXT, PRIMARY KEY("BookId","Position"));
CREATE INDEX book_author ON "BookAuthor"("AuthorId");
CREATE TABLE "BookReference" ("BookId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "Book"("Id"), "Reference" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("Reference") AND json_type("Reference") = 'object'), "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "BookOtherAttribute" ("BookId" VARCHAR(26) NOT NULL PRIMARY KEY REFERENCES "Book"("Id"), "Attribute" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("Attribute") AND json_type("Attribute") = 'object'), "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Copy" ("Id" VARCHAR(26) NOT NULL PRIMARY KEY, "BookId" VARCHAR(26) NOT NULL REFERENCES "Book"("Id"),
 "ManagementCode" TEXT NOT NULL UNIQUE CHECK (length(trim("ManagementCode"))>0), "DeliveredAt" DATETIME,
 "Condition" TEXT CHECK ("Condition" IN ('normal','lost','damaged','stolen','unknown')) NOT NULL DEFAULT 'normal', "LoanPolicy" TEXT CHECK ("LoanPolicy" IN ('available','suspended','no_loan','in_library_only','no_access')) NOT NULL DEFAULT 'available', "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "UpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "CreatedBy" TEXT REFERENCES users(id), "UpdatedBy" TEXT REFERENCES users(id), "Version" INTEGER NOT NULL DEFAULT 1 CHECK ("Version">0));
CREATE INDEX copy_book ON "Copy"("BookId");
CREATE TABLE "ChangeBatch" ("Id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))), "ActorUserId" TEXT REFERENCES users(id), "ActorDisplayName" TEXT, "Source" TEXT, "Reason" TEXT,
 "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX change_batch_actor ON "ChangeBatch"("ActorUserId");
CREATE INDEX change_batch_created ON "ChangeBatch"("CreatedAt");
CREATE TABLE "ChangeHistory" ("Id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))), "BatchId" TEXT NOT NULL REFERENCES "ChangeBatch"("Id"),
 "EntityType" TEXT NOT NULL, "EntityId" TEXT NOT NULL, "Operation" TEXT CHECK ("Operation" IN ('create','update','delete')) NOT NULL,
 "SnapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("SnapshotSchemaVersion">0), "EntityVersion" INTEGER,
 "BeforeData" TEXT, "AfterData" TEXT, "CreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("Operation"='create' AND "BeforeData" IS NULL AND "AfterData" IS NOT NULL) OR ("Operation"='update' AND "BeforeData" IS NOT NULL AND "AfterData" IS NOT NULL) OR ("Operation"='delete' AND "BeforeData" IS NOT NULL AND "AfterData" IS NULL)),
 CHECK ("BeforeData" IS NULL OR (json_valid("BeforeData") AND json_type("BeforeData") = 'object')), CHECK ("AfterData" IS NULL OR (json_valid("AfterData") AND json_type("AfterData") = 'object')));
CREATE INDEX change_history_batch ON "ChangeHistory"("BatchId");
CREATE INDEX change_history_entity ON "ChangeHistory"("EntityType","EntityId","CreatedAt");
