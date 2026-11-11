public class TestConnection {

    public static void main(String[] args) {

        try (var connection = DatabaseConnection.getConnection()) {
            if (!connection.isValid(5)) {
                throw new IllegalStateException("Database connection is not valid.");
            }
            System.out.println("Successfully connected to Supabase!");

        } catch (Exception e) {
            System.out.println("Connection failed!");
            e.printStackTrace();
        }
    }
}