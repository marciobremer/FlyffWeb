-- Create topup_items table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='topup_items' and xtype='U')
BEGIN
    CREATE TABLE topup_items (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        description NVARCHAR(MAX),
        price DECIMAL(10,2) NOT NULL,
        points INT NOT NULL,
        category NVARCHAR(50) NOT NULL,
        is_on_sale BIT DEFAULT 0,
        sale_percentage INT,
        image_url NVARCHAR(MAX),
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE()
    )

    -- Create index on category for faster filtering
    CREATE INDEX idx_topup_items_category ON topup_items(category)

    -- Add some sample data
    INSERT INTO topup_items (name, description, price, points, category, is_on_sale, sale_percentage, image_url) 
    VALUES 
        (N'500 Cash Points', N'Get 500 Cash Points to spend in the game shop', 4.99, 500, 'cash', 0, NULL, N'https://example.com/cash-points.png'),
        (N'1000 Cash Points', N'Get 1000 Cash Points with 10% bonus', 9.99, 1100, 'cash', 0, NULL, N'https://example.com/cash-points.png'),
        (N'2000 Cash Points', N'Get 2000 Cash Points with 15% bonus', 19.99, 2300, 'cash', 1, 20, N'https://example.com/cash-points.png'),
        (N'100 Vote Points', N'Get 100 Vote Points instantly', 1.99, 100, 'vote', 0, NULL, N'https://example.com/vote-points.png'),
        (N'Special Package', N'Get exclusive items and 1000 points', 24.99, 1000, 'special', 1, 15, N'https://example.com/special.png')
END 