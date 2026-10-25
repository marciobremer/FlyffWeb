USE [WEBSITE_DBF]
GO

-- Create topup_requests table if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[topup_requests]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[topup_requests] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [user_id] INT NOT NULL,
        [item_id] INT NOT NULL,
        [username] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(10,2) NOT NULL,
        [points] INT NOT NULL,
        [attachment_url] NVARCHAR(255) NOT NULL,
        [status] NVARCHAR(20) NOT NULL DEFAULT 'pending',
        [created_at] DATETIME NOT NULL DEFAULT GETDATE(),
        [updated_at] DATETIME NOT NULL DEFAULT GETDATE(),
        [processed_at] DATETIME NULL,
        [processed_by] INT NULL,
        [notes] NVARCHAR(MAX) NULL
    )
END
GO

-- Create indexes if they don't exist
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_topup_requests_user_id' AND object_id = OBJECT_ID('topup_requests'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_topup_requests_user_id] ON [dbo].[topup_requests] ([user_id] ASC)
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_topup_requests_status' AND object_id = OBJECT_ID('topup_requests'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_topup_requests_status] ON [dbo].[topup_requests] ([status] ASC)
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_topup_requests_created_at' AND object_id = OBJECT_ID('topup_requests'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_topup_requests_created_at] ON [dbo].[topup_requests] ([created_at] ASC)
END
GO