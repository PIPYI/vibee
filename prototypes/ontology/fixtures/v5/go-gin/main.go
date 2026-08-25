package main

import "github.com/gin-gonic/gin"

func main() {
	router := gin.Default()
	router.GET("/api/users/:id", getUser)
	router.POST("/api/users", createUser)
	router.Run()
}
