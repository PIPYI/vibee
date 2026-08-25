using Microsoft.AspNetCore.Mvc;

namespace Example.Controllers
{
    [ApiController]
    public class UsersController : ControllerBase
    {
        [HttpGet("/api/users/{id}")]
        public User GetUser(string id) => userService.Find(id);

        [HttpPost("/api/users")]
        public User CreateUser([FromBody] User user) => userService.Create(user);
    }
}
