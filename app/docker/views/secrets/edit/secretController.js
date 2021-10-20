angular.module('portainer.docker').controller('SecretController', [
  '$scope',
  '$transition$',
  '$state',
  'SecretService',
  'Notifications',
  function ($scope, $transition$, $state, SecretService, Notifications) {
    $scope.removeSecret = function removeSecret(secretId) {
      SecretService.remove(secretId)
        .then(function success() {
          Notifications.success('Secret successfully removed');
          $state.go('docker.secrets', {});
        })
        .catch(function error(err) {
          Notifications.error('失败', err, 'Unable to remove secret');
        });
    };

    function initView() {
      SecretService.secret($transition$.params().id)
        .then(function success(data) {
          $scope.secret = data;
        })
        .catch(function error(err) {
          Notifications.error('失败', err, 'Unable to retrieve secret details');
        });
    }

    initView();
  },
]);
