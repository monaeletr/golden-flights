
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

import io.github.cdimascio.dotenv.Dotenv;

public class DatabaseConnection {

    private static final Dotenv dotenv = Dotenv.load();

    private static final String URL = dotenv.get("SUPABASE_DB_URL");

    public static Connection getConnection() throws SQLException {
        return DriverManager.getConnection(URL);
    }
}