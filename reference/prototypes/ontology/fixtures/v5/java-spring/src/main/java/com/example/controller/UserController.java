package com.example.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/api/users/{id}")
    public User getUser(@PathVariable String id) {
        return userService.find(id);
    }

    @PostMapping("/api/users")
    public User createUser(@RequestBody User user) {
        return userService.create(user);
    }
}
