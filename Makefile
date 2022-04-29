CUR_DIR := $(shell pwd)
NVM := https://raw.githubusercontent.com/creationix/nvm/v0.33.11/install.sh
NODE_VERSION := 0.10.40
NODE_GYP_VERSION := 3.4.0
# xgateway environment variables
XWRAPPERS := $(CUR_DIR)/wrappers
WS_SERVER := $(CUR_DIR)/ws-server
GLOBALSJS := $(CUR_DIR)/globalsjs
XNODEM := $(CUR_DIR)/xnodem
XNODEM_LINK := http://svn.komitex.ru/svn/xnodem
PROFILE := $(CUR_DIR)/.xgateway_profile

NPM_STATUS := $(shell if test -n "$$(command -v npm)"; then echo installed; else echo notfound; fi)
NODE_GYP_STATUS := $(shell if test -n "$$(command -v node-gyp)"; then echo installed; else echo notfound; fi)

.PHONY: all

all: install

nvm:
	@if test -d $$HOME/.nvm; then \
		echo "#"; \
		echo "# Directory $$HOME/.nvm already exists."; \
		echo "#"; \
	else \
		curl -o- $(NVM) | /bin/bash; \
		if test -L $$HOME/.iks_environment || test -f $$HOME/.iks_environment; then \
			if test -z "$$(grep -o iks_environment $$HOME/.profile)"; then \
				echo '\n. $$HOME/.iks_environment' >> $$HOME/.profile; \
			fi; \
		fi; \
	fi

node: nvm
	@if test -z "$$(command -v node)" && test -z "$$(command -v node-gyp)"; then \
		echo "# Close and reopen your terminal to start using nvm."; \
		echo "# Environment will be set only for interractive session."; \
		echo "#"; \
		echo "# Then run the following in interractive session:"; \
		echo "# \tnvm install $(NODE_VERSION)"; \
		echo "# \tnpm install -g node-gyp@$(NODE_GYP_VERSION)"; \
		echo "#"; \
	else true; fi

define genProfile
cat <<-PR > $(PROFILE)
. $$HOME/.iks_environment
export XNODEM_ENCODING="cp866"
export XNODEM_AUTO_RELINK=1
export GTMCI="$(XNODEM)/resources/nodem.ci"
export gtmroutines="$(XNODEM)/src/test $(XWRAPPERS) $(XNODEM)/src $$gtmroutines"
PR
endef

deps:
	@echo "Install C++ compiller"
	@sudo apt-get update
	@sudo apt-get install g++ || true

.ONESHELL:
install: node deps
ifeq ($(NPM_STATUS),installed)
ifeq ($(NODE_GYP_STATUS),installed)
	test -d $(XNODEM) || svn co $(XNODEM_LINK)
	npm install $(XNODEM)
	npm install $(GLOBALSJS)
	# install dependencies listed in package.json file 
	npm install
	$(call genProfile)
	(cd $(WS_SERVER) && ./config.sh > config.json)
	(cd $(WS_SERVER) && ln -vsf $(PROFILE))
	if test -f $(CUR_DIR)/service/xgateway.service; then
		sudo cp -v $(CUR_DIR)/service/xgateway.service /etc/systemd/system/
		sudo systemctl daemon-reload
		sudo systemctl enable xgateway.service
	fi
else
	@echo "Node-gyp is not installed. Run 'npm install -g node-gyp@$(NODE_GYP_VERSION)'"
endif
else
	@echo "Node is not installed. Run 'nvm install $(NODE_VERSION)'" 
endif
