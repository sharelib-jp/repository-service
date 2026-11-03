package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/connectors"
	"github.com/sharelib-jp/repository-service/internal/api"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
	"github.com/sharelib-jp/repository-service/internal/database"
	"github.com/sharelib-jp/repository-service/internal/external"
	"github.com/sharelib-jp/repository-service/migrations"
)

func main() {
	configPath := flag.String("config", "./config.toml", "configuration file")
	webDirectory := flag.String("web", "../web/dist", "built frontend directory")
	flag.Parse()
	conf, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}

	db, err := database.OpenWithDriver(conf.DATABASE_DRIVER, conf.DATABASE_DSN)
	if err != nil {
		log.Fatal("Failed to initialize database: ", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()

	store := catalogstore.New(db)
	auth, err := api.NewAuthenticator(conf, store)
	if err != nil {
		log.Fatal(err)
	}
	browserAuth, err := api.NewBrowserAuth(conf, store, auth)
	if err != nil {
		log.Fatal("Failed to configure login: ", err)
	}
	if browserAuth != nil {
		auth = browserAuth
	}
	sources, err := external.Load(conf.External.SourcesFile, connectors.Files)
	if err != nil {
		log.Fatal("Failed to load external sources: ", err)
	}
	if err := migrations.Apply(db); err != nil {
		log.Fatal("Failed to migrate catalog: ", err)
	}
	router := api.NewRouter(conf, api.Dependencies{Store: store, External: sources, Authenticate: auth, BrowserAuth: browserAuth})
	api.RegisterFrontend(router, *webDirectory)

	server := &http.Server{
		Addr: conf.PORT, Handler: router,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
	}
	log.Printf("Listening on %s (origin: %s)", conf.PORT, conf.Origin())
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal("Failed to start server: ", err)
	}
}
