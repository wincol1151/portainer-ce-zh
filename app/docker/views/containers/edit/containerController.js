import moment from 'moment';
import _ from 'lodash-es';
import { PorImageRegistryModel } from 'Docker/models/porImageRegistry';

angular.module('portainer.docker').controller('ContainerController', [
  '$q',
  '$scope',
  '$state',
  '$transition$',
  '$filter',
  '$async',
  'Commit',
  'ContainerHelper',
  'ContainerService',
  'ImageHelper',
  'NetworkService',
  'Notifications',
  'ModalService',
  'ResourceControlService',
  'RegistryService',
  'ImageService',
  'HttpRequestHelper',
  'Authentication',
  'endpoint',
  function (
    $q,
    $scope,
    $state,
    $transition$,
    $filter,
    $async,
    Commit,
    ContainerHelper,
    ContainerService,
    ImageHelper,
    NetworkService,
    Notifications,
    ModalService,
    ResourceControlService,
    RegistryService,
    ImageService,
    HttpRequestHelper,
    Authentication,
    endpoint
  ) {
    $scope.endpoint = endpoint;
    $scope.isAdmin = Authentication.isAdmin();
    $scope.activityTime = 0;
    $scope.portBindings = [];
    $scope.displayRecreateButton = false;

    $scope.config = {
      RegistryModel: new PorImageRegistryModel(),
      commitInProgress: false,
    };

    $scope.state = {
      recreateContainerInProgress: false,
      joinNetworkInProgress: false,
      leaveNetworkInProgress: false,
      pullImageValidity: false,
    };

    $scope.setPullImageValidity = setPullImageValidity;
    function setPullImageValidity(validity) {
      $scope.state.pullImageValidity = validity;
    }

    $scope.updateRestartPolicy = updateRestartPolicy;

    var update = function () {
      var nodeName = $transition$.params().nodeName;
      HttpRequestHelper.setPortainerAgentTargetHeader(nodeName);
      $scope.nodeName = nodeName;

      ContainerService.container($transition$.params().id)
        .then(function success(data) {
          var container = data;
          $scope.container = container;
          $scope.container.edit = false;
          $scope.container.newContainerName = $filter('trimcontainername')(container.Name);

          if (container.State.Running) {
            $scope.activityTime = moment.duration(moment(container.State.StartedAt).utc().diff(moment().utc())).humanize();
          } else if (container.State.Status === 'created') {
            $scope.activityTime = moment.duration(moment(container.Created).utc().diff(moment().utc())).humanize();
          } else {
            $scope.activityTime = moment.duration(moment().utc().diff(moment(container.State.FinishedAt).utc())).humanize();
          }

          $scope.portBindings = [];
          if (container.NetworkSettings.Ports) {
            _.forEach(Object.keys(container.NetworkSettings.Ports), function (key) {
              if (container.NetworkSettings.Ports[key]) {
                _.forEach(container.NetworkSettings.Ports[key], (portMapping) => {
                  const mapping = {};
                  mapping.container = key;
                  mapping.host = `${portMapping.HostIp}:${portMapping.HostPort}`;
                  $scope.portBindings.push(mapping);
                });
              }
            });
          }

          $scope.container.Config.Env = _.sortBy($scope.container.Config.Env, _.toLower);
          const inSwarm = $scope.container.Config.Labels['com.docker.swarm.service.id'];
          const autoRemove = $scope.container.HostConfig.AutoRemove;
          const admin = Authentication.isAdmin();
          const {
            allowContainerCapabilitiesForRegularUsers,
            allowHostNamespaceForRegularUsers,
            allowDeviceMappingForRegularUsers,
            allowSysctlSettingForRegularUsers,
            allowBindMountsForRegularUsers,
            allowPrivilegedModeForRegularUsers,
          } = endpoint.SecuritySettings;

          const settingRestrictsRegularUsers =
            !allowContainerCapabilitiesForRegularUsers ||
            !allowBindMountsForRegularUsers ||
            !allowDeviceMappingForRegularUsers ||
            !allowSysctlSettingForRegularUsers ||
            !allowHostNamespaceForRegularUsers ||
            !allowPrivilegedModeForRegularUsers;

          $scope.displayRecreateButton = !inSwarm && !autoRemove && (admin || !settingRestrictsRegularUsers);
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法检索容器信息');
        });
    };

    function executeContainerAction(id, action, successMessage, errorMessage) {
      action(id)
        .then(function success() {
          Notifications.success(successMessage, id);
          update();
        })
        .catch(function error(err) {
          Notifications.error('失败', err, errorMessage);
        });
    }

    $scope.start = function () {
      var successMessage = '容器已成功启动';
      var errorMessage = '无法启动容器';
      executeContainerAction($transition$.params().id, ContainerService.startContainer, successMessage, errorMessage);
    };

    $scope.stop = function () {
      var successMessage = '容器已成功停止';
      var errorMessage = '无法停止容器r';
      executeContainerAction($transition$.params().id, ContainerService.stopContainer, successMessage, errorMessage);
    };

    $scope.kill = function () {
      var successMessage = '成功终止容器';
      var errorMessage = '无法终止容器';
      executeContainerAction($transition$.params().id, ContainerService.killContainer, successMessage, errorMessage);
    };

    $scope.pause = function () {
      var successMessage = '容器已成功暂停';
      var errorMessage = '无法暂停容器';
      executeContainerAction($transition$.params().id, ContainerService.pauseContainer, successMessage, errorMessage);
    };

    $scope.unpause = function () {
      var successMessage = '容器已成功恢复';
      var errorMessage = '无法恢复容器';
      executeContainerAction($transition$.params().id, ContainerService.resumeContainer, successMessage, errorMessage);
    };

    $scope.restart = function () {
      var successMessage = '容器已成功重新启动';
      var errorMessage = '无法重新启动容器';
      executeContainerAction($transition$.params().id, ContainerService.restartContainer, successMessage, errorMessage);
    };

    $scope.renameContainer = function () {
      var container = $scope.container;
      ContainerService.renameContainer($transition$.params().id, container.newContainerName)
        .then(function success() {
          container.Name = container.newContainerName;
          Notifications.success('容器已成功重命名', container.Name);
        })
        .catch(function error(err) {
          container.newContainerName = container.Name;
          Notifications.error('失败', err, '无法重命名容器');
        })
        .finally(function final() {
          $scope.container.edit = false;
        });
    };

    $scope.containerLeaveNetwork = function containerLeaveNetwork(container, networkId) {
      $scope.state.leaveNetworkInProgress = true;
      NetworkService.disconnectContainer(networkId, container.Id, false)
        .then(function success() {
          Notifications.success('Container left network', container.Id);
          $state.reload();
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法断开容器与网络的连接');
        })
        .finally(function final() {
          $scope.state.leaveNetworkInProgress = false;
        });
    };

    $scope.containerJoinNetwork = function containerJoinNetwork(container, networkId) {
      $scope.state.joinNetworkInProgress = true;
      NetworkService.connectContainer(networkId, container.Id)
        .then(function success() {
          Notifications.success('容器连接网络', container.Id);
          $state.reload();
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法将容器连接到网络');
        })
        .finally(function final() {
          $scope.state.joinNetworkInProgress = false;
        });
    };

    async function commitContainerAsync() {
      $scope.config.commitInProgress = true;
      const registryModel = $scope.config.RegistryModel;
      const imageConfig = ImageHelper.createImageConfigForContainer(registryModel);
      try {
        await Commit.commitContainer({ id: $transition$.params().id, repo: imageConfig.fromImage }).$promise;
        Notifications.success('Image created', $transition$.params().id);
        $state.reload();
      } catch (err) {
        Notifications.error('失败', err, '无法创建镜像');
        $scope.config.commitInProgress = false;
      }
    }

    $scope.commit = function () {
      return $async(commitContainerAsync);
    };

    $scope.confirmRemove = function () {
      var title = '您即将删除一个容器。';
      if ($scope.container.State.Running) {
        title = '您即将删除正在运行的容器。';
      }
      ModalService.confirmContainerDeletion(title, function (result) {
        if (!result) {
          return;
        }
        var cleanAssociatedVolumes = false;
        if (result[0]) {
          cleanAssociatedVolumes = true;
        }
        removeContainer(cleanAssociatedVolumes);
      });
    };

    function removeContainer(cleanAssociatedVolumes) {
      ContainerService.remove($scope.container, cleanAssociatedVolumes)
        .then(function success() {
          Notifications.success('容器成功删除');
          $state.go('docker.containers', {}, { reload: true });
        })
        .catch(function error(err) {
          Notifications.error('失败', err, '无法删除容器');
        });
    }

    function recreateContainer(pullImage) {
      var container = $scope.container;
      var config = ContainerHelper.configFromContainer(container.Model);
      $scope.state.recreateContainerInProgress = true;
      var isRunning = container.State.Running;

      return pullImageIfNeeded()
        .then(stopContainerIfNeeded)
        .then(renameContainer)
        .then(setMainNetworkAndCreateContainer)
        .then(connectContainerToOtherNetworks)
        .then(startContainerIfNeeded)
        .then(createResourceControl)
        .then(deleteOldContainer)
        .then(notifyAndChangeView)
        .catch(notifyOnError);

      function stopContainerIfNeeded() {
        if (!isRunning) {
          return $q.when();
        }
        return ContainerService.stopContainer(container.Id);
      }

      function renameContainer() {
        return ContainerService.renameContainer(container.Id, container.Name + '-old');
      }

      function pullImageIfNeeded() {
        if (!pullImage) {
          return $q.when();
        }
        return RegistryService.retrievePorRegistryModelFromRepository(container.Config.Image, endpoint.Id).then((registryModel) => {
          return ImageService.pullImage(registryModel, true);
        });
      }

      function setMainNetworkAndCreateContainer() {
        var networks = config.NetworkingConfig.EndpointsConfig;
        var networksNames = Object.keys(networks);
        if (networksNames.length > 1) {
          config.NetworkingConfig.EndpointsConfig = {};
          config.NetworkingConfig.EndpointsConfig[networksNames[0]] = networks[0];
        }
        return $q.all([ContainerService.createContainer(config), networks]);
      }

      function connectContainerToOtherNetworks(createContainerData) {
        var newContainer = createContainerData[0];
        var networks = createContainerData[1];
        var networksNames = Object.keys(networks);
        var connectionPromises = networksNames.map(function connectToNetwork(name) {
          NetworkService.connectContainer(name, newContainer.Id);
        });
        return $q.all(connectionPromises).then(function onConnectToNetworkSuccess() {
          return newContainer;
        });
      }

      function deleteOldContainer(newContainer) {
        return ContainerService.remove(container, true).then(function onRemoveSuccess() {
          return newContainer;
        });
      }

      function startContainerIfNeeded(newContainer) {
        if (!isRunning) {
          return $q.when(newContainer);
        }
        return ContainerService.startContainer(newContainer.Id).then(function onStartSuccess() {
          return newContainer;
        });
      }

      function createResourceControl(newContainer) {
        const userId = Authentication.getUserDetails().ID;
        const oldResourceControl = container.ResourceControl;
        const newResourceControl = newContainer.Portainer.ResourceControl;
        return ResourceControlService.duplicateResourceControl(userId, oldResourceControl, newResourceControl);
      }

      function notifyAndChangeView() {
        Notifications.success('容器重新创建成功');
        $state.go('docker.containers', {}, { reload: true });
      }

      function notifyOnError(err) {
        Notifications.error('失败', err, '无法重新创建容器');
        $scope.state.recreateContainerInProgress = false;
      }
    }

    $scope.recreate = function () {
      ModalService.confirmContainerRecreation(function (result) {
        if (!result) {
          return;
        }
        var pullImage = false;
        if (result[0]) {
          pullImage = true;
        }
        recreateContainer(pullImage);
      });
    };

    function updateRestartPolicy(restartPolicy, maximumRetryCount) {
      maximumRetryCount = restartPolicy === 'on-failure' ? maximumRetryCount : undefined;

      return ContainerService.updateRestartPolicy($scope.container.Id, restartPolicy, maximumRetryCount).then(onUpdateSuccess).catch(notifyOnError);

      function onUpdateSuccess() {
        $scope.container.HostConfig.RestartPolicy = {
          Name: restartPolicy,
          MaximumRetryCount: maximumRetryCount,
        };
        Notifications.success('重启策略已更新');
      }

      function notifyOnError(err) {
        Notifications.error('失败', err, '无法更新重启策略');
        return $q.reject(err);
      }
    }

    var provider = $scope.applicationState.endpoint.mode.provider;
    var apiVersion = $scope.applicationState.endpoint.apiVersion;
    NetworkService.networks(provider === 'DOCKER_STANDALONE' || provider === 'DOCKER_SWARM_MODE', false, provider === 'DOCKER_SWARM_MODE' && apiVersion >= 1.25)
      .then(function success(data) {
        var networks = data;
        $scope.availableNetworks = networks;
      })
      .catch(function error(err) {
        Notifications.error('失败', err, '无法检索网络');
      });

    update();
  },
]);
