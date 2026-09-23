using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LendingDesk.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddItemCondition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Condition",
                table: "Items",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Good");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Condition",
                table: "Items");
        }
    }
}
